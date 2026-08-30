import { TicketPriority } from "../../generated/prisma/client.js";

export type ClassificationResult = {
  categoryName: string;
  priority: TicketPriority;
  summary: string;
};

export type ClassificationService = {
  classify(input: { title: string; description: string }): Promise<ClassificationResult>;
};

// Temporary deterministic fallback. A future OpenAI implementation can replace
// this service without changing ticket controllers or persistence contracts.
export const fallbackClassificationService: ClassificationService = {
  classify: async ({ title }) => ({
    categoryName: "Other",
    priority: TicketPriority.MEDIUM,
    summary: `Automatic classification is pending for: ${title}`,
  }),
};
