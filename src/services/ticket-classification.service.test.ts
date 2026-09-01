import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CategorySource, TicketPriority, type PrismaClient } from "../../generated/prisma/client.js";
import type { ClassificationService } from "./classification.service.js";
import { TicketService } from "./ticket.service.js";

const hardware = { id: "10000000-0000-4000-8000-000000000001", name: "Hardware" };
const network = { id: "10000000-0000-4000-8000-000000000002", name: "Network" };
const other = { id: "10000000-0000-4000-8000-000000000003", name: "Other" };
const categories = [hardware, network, other];
const baseInput = { title: "Cannot use campus Wi-Fi", description: "My laptop cannot connect to campus Wi-Fi.", location: "CL" };

const createHarness = (classifier: ClassificationService) => {
  let created: Record<string, unknown> | undefined;
  const database = {
    category: { findMany: async () => categories },
    ticket: { create: async ({ data }: { data: Record<string, unknown> }) => { created = data; return data; } },
  } as unknown as PrismaClient;
  return { service: new TicketService(database, classifier), created: () => created! };
};

describe("ticket creation classification", () => {
  it("preserves a user category while saving separate AI suggestions", async () => {
    const harness = createHarness({ classify: async () => ({
      categoryName: "Network", priority: TicketPriority.HIGH, summary: "Laptop cannot connect to campus Wi-Fi.",
    }) });
    await harness.service.create("creator", { ...baseInput, categoryIntent: "CATEGORY", categoryId: hardware.id });
    assert.equal(harness.created().categoryId, hardware.id);
    assert.equal(harness.created().categorySource, CategorySource.USER_SELECTED);
    assert.equal(harness.created().priority, TicketPriority.HIGH);
    assert.equal(harness.created().aiSuggestedCategoryId, network.id);
    assert.equal(harness.created().aiSuggestedPriority, TicketPriority.HIGH);
    assert.equal(harness.created().aiSummary, "Laptop cannot connect to campus Wi-Fi.");
  });

  it("uses a valid AI category for auto-detect", async () => {
    const harness = createHarness({ classify: async () => ({ categoryName: "Network", priority: TicketPriority.MEDIUM }) });
    await harness.service.create("creator", { ...baseInput, categoryIntent: "AUTO_DETECT" });
    assert.equal(harness.created().categoryId, network.id);
    assert.equal(harness.created().categorySource, CategorySource.AI_SUGGESTED);
    assert.equal(harness.created().aiSuggestedCategoryId, network.id);
  });

  for (const failure of [
    new Error("malformed output"),
    new Error("request timed out"),
    new Error("rate limit"),
    new Error("provider unavailable"),
  ]) {
    it(`falls back without losing an auto-detect ticket: ${failure.message}`, async () => {
      const harness = createHarness({ classify: async () => { throw failure; } });
      await harness.service.create("creator", { ...baseInput, categoryIntent: "AUTO_DETECT" });
      assert.equal(harness.created().categoryId, other.id);
      assert.equal(harness.created().priority, TicketPriority.MEDIUM);
      assert.equal(harness.created().aiSuggestedCategoryId, null);
    });
  }

  it("falls back safely when a fake classifier returns an inactive or nonexistent category", async () => {
    const harness = createHarness({ classify: async () => ({ categoryName: "Disabled", priority: TicketPriority.URGENT }) });
    await harness.service.create("creator", { ...baseInput, categoryIntent: "AUTO_DETECT" });
    assert.equal(harness.created().categoryId, other.id);
    assert.equal(harness.created().priority, TicketPriority.MEDIUM);
  });

  it("keeps a user-selected category and uses MEDIUM if classification fails", async () => {
    const harness = createHarness({ classify: async () => { throw new Error("OpenAI unavailable"); } });
    await harness.service.create("creator", { ...baseInput, categoryIntent: "CATEGORY", categoryId: hardware.id });
    assert.equal(harness.created().categoryId, hardware.id);
    assert.equal(harness.created().categorySource, CategorySource.USER_SELECTED);
    assert.equal(harness.created().priority, TicketPriority.MEDIUM);
    assert.equal(harness.created().aiSuggestedCategoryId, null);
  });
});
