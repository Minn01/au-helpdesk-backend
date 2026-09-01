import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TicketPriority } from "../../generated/prisma/client.js";
import { OpenAIClassificationService } from "./openai-classification.service.js";

const input = {
  title: "Cannot connect to university Wi-Fi",
  description: "My laptop connects to my hotspot but not university Wi-Fi.",
  location: "CL Building",
  activeCategoryNames: ["Network", "Other"],
};

describe("OpenAI ticket classification adapter", () => {
  it("uses schema-constrained Responses API output and validates it", async () => {
    let request: Record<string, unknown> | undefined;
    const service = new OpenAIClassificationService("not-a-real-key", "gpt-5.6-luna", 8_000, {
      responses: { create: async (value) => {
        request = value;
        return { output_text: JSON.stringify({ category: "Network", priority: "HIGH", summary: "Laptop cannot connect to university Wi-Fi." }) };
      } },
    });
    assert.deepEqual(await service.classify(input), {
      categoryName: "Network",
      priority: TicketPriority.HIGH,
      summary: "Laptop cannot connect to university Wi-Fi.",
    });
    assert.equal(request?.model, "gpt-5.6-luna");
    assert.equal(request?.store, false);
    assert.equal((request?.text as { format: { type: string; strict: boolean } }).format.type, "json_schema");
    assert.equal((request?.text as { format: { type: string; strict: boolean } }).format.strict, true);
    assert.doesNotMatch(String(request?.input), /not-a-real-key/);
  });

  for (const [name, output] of [
    ["malformed JSON", "not json"],
    ["nonexistent category", JSON.stringify({ category: "Software", priority: "MEDIUM", summary: null })],
    ["invalid priority", JSON.stringify({ category: "Network", priority: "CRITICAL", summary: null })],
    ["oversized summary", JSON.stringify({ category: "Network", priority: "MEDIUM", summary: "x".repeat(241) })],
  ] as const) {
    it(`rejects ${name}`, async () => {
      const service = new OpenAIClassificationService("key", "model", 8_000, {
        responses: { create: async () => ({ output_text: output }) },
      });
      await assert.rejects(service.classify(input));
    });
  }
});
