import { TicketPriority } from "../../generated/prisma/client.js";

export type ClassificationResult = {
  categoryName: string;
  priority: TicketPriority;
  summary?: string | undefined;
};

export type ClassificationInput = {
  title: string;
  description: string;
  location: string | null;
  activeCategoryNames: readonly string[];
};

export type ClassificationService = {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
};
