import { prisma } from "../lib/prisma.js";
import type { UserRepository } from "./auth.types.js";

export const userRepository: UserRepository = {
  findById: (id) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
      },
    }),
};
