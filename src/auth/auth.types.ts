import type { UserRole } from "../../generated/prisma/client.js";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
};

export type UserRepository = {
  findById(id: string): Promise<AuthUser | null>;
};
