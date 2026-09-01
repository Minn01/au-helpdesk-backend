import OpenAI from "openai";
import { TicketPriority } from "../../generated/prisma/client.js";
import type { ClassificationInput, ClassificationResult, ClassificationService } from "./classification.service.js";

type ResponsesClient = {
  responses: { create(input: Record<string, unknown>): Promise<{ output_text: string }> };
};

const priorities = Object.values(TicketPriority);
const summaryLimit = 240;

const parseResult = (output: string, activeCategoryNames: readonly string[]): ClassificationResult => {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("OpenAI classification response was not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenAI classification response was not an object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["category", "priority", "summary"].includes(key))) {
    throw new Error("OpenAI classification response contained unexpected fields");
  }
  if (typeof record.category !== "string" || !activeCategoryNames.includes(record.category)) {
    throw new Error("OpenAI classification response contained an unavailable category");
  }
  if (typeof record.priority !== "string" || !priorities.includes(record.priority as TicketPriority)) {
    throw new Error("OpenAI classification response contained an invalid priority");
  }
  if (record.summary !== null && typeof record.summary !== "string") {
    throw new Error("OpenAI classification response contained an invalid summary");
  }
  const summary = typeof record.summary === "string" ? record.summary.trim() : undefined;
  if (summary !== undefined && (summary.length === 0 || summary.length > summaryLimit)) {
    throw new Error("OpenAI classification response summary was invalid");
  }
  return {
    categoryName: record.category,
    priority: record.priority as TicketPriority,
    ...(summary ? { summary } : {}),
  };
};

export class OpenAIClassificationService implements ClassificationService {
  private readonly client: ResponsesClient;

  constructor(apiKey: string, private readonly model: string, timeoutMs: number, client?: ResponsesClient) {
    this.client = client ?? new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  }

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    if (input.activeCategoryNames.length === 0) throw new Error("No active categories are available for classification");
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: 160,
      instructions: [
        "Classify a university IT help desk ticket using only the supplied category names.",
        "Priority guidance: LOW is minor/non-blocking; MEDIUM is ordinary individual support; HIGH materially blocks work or study; URGENT is a broad outage, severe system failure, or major time-critical academic impact.",
        "Keep the summary factual, one short sentence, and do not add diagnosis, instructions, or details absent from the ticket. Use null if no useful summary is possible.",
      ].join(" "),
      input: JSON.stringify({
        title: input.title,
        description: input.description,
        ...(input.location ? { location: input.location } : {}),
        activeCategories: input.activeCategoryNames,
      }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "ticket_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              category: { type: "string", enum: input.activeCategoryNames },
              priority: { type: "string", enum: priorities },
              summary: { type: ["string", "null"], maxLength: summaryLimit },
            },
            required: ["category", "priority", "summary"],
          },
        },
      },
    });
    return parseResult(response.output_text, input.activeCategoryNames);
  }
}
