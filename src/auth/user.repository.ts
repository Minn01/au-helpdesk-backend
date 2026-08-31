import type { PrismaClient } from "../../generated/prisma/client.js";
import type { UserRepository } from "./auth.types.js";

export const createUserRepository = (database: PrismaClient): UserRepository => ({
  findById: (id) =>
    database.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
      },
    }),
});
