import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { UserRole } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { PrismaMicrosoftUserProvisioner } from "./microsoft-auth.service.js";

const createdIds: string[] = [];
const provisioner = new PrismaMicrosoftUserProvisioner(prisma);

describe("Microsoft user provisioning", () => {
  after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it("links an existing HelpDesk user by email without changing their role", async () => {
    const user = await prisma.user.create({
      data: {
        email: `phase7-existing-${randomUUID()}@au.edu`,
        displayName: "Existing Faculty",
        role: UserRole.FACULTY,
      },
    });
    createdIds.push(user.id);
    const tenantId = randomUUID();
    const objectId = randomUUID();
    const result = await provisioner.findOrCreate({
      tenantId,
      objectId,
      email: user.email.toUpperCase(),
      displayName: "Microsoft Display Name",
    });
    assert.equal(result.id, user.id);
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(linked.role, UserRole.FACULTY);
    assert.equal(linked.microsoftTenantId, tenantId);
    assert.equal(linked.microsoftObjectId, objectId);
  });

  it("creates a new Microsoft identity with the safe STUDENT default role", async () => {
    const result = await provisioner.findOrCreate({
      tenantId: randomUUID(),
      objectId: randomUUID(),
      email: `phase7-new-${randomUUID()}@au.edu`,
      displayName: "New University User",
    });
    createdIds.push(result.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(user.role, UserRole.STUDENT);
    assert.equal(user.isActive, true);
  });
});
