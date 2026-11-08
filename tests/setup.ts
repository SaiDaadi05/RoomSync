import { config } from "dotenv";
import { beforeEach, afterAll } from "vitest";

config({ path: ".env.test", override: true });
process.env.STORAGE_DIR = "./storage-test";
process.env.SMTP_HOST = "";
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");

const { prisma } = await import("@/server/db");

beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
