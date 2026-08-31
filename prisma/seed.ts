import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the development database");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed is disabled when NODE_ENV=production");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const categories = [
  ["Network", "Wi-Fi, wired network, and connectivity issues"],
  ["Hardware", "University-owned computers and peripheral hardware"],
  ["Software", "Applications, licensing, and installation support"],
  ["University Account", "University identity and account access"],
  ["Course Registration", "Technical issues affecting course registration"],
  ["Printer", "Campus printing and printer problems"],
  ["Classroom Equipment", "Teaching-room displays, audio, and control systems"],
  ["Other", "Requests that do not match another active category"],
] as const;

const seed = async () => {
  for (const [name, description] of categories) {
    await prisma.category.upsert({
      where: { name },
      update: { description, isActive: true },
      create: { name, description },
    });
  }

  console.log(`Seeded ${categories.length} ticket categories.`);
};

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
