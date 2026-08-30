import type { PrismaClient } from "../../generated/prisma/client.js";

export class CategoryService {
  constructor(private readonly database: PrismaClient) {}

  async listActive(): Promise<Array<{ id: string; name: string; description: string | null }>> {
    return await this.database.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
  }
}

export type CategoryApi = Pick<CategoryService, "listActive">;
