import "dotenv/config";
import { prisma } from "../src/server/db";
import { createSampleHousehold } from "../src/server/sample-data";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: "alex@example.com" } });
  if (existing) {
    console.log("Sample data already present (alex@example.com). Skipping.");
    return;
  }
  const { household } = await createSampleHousehold({ isDemo: false, emailDomain: "example.com", password: "password123" });
  console.log(`Seeded "${household.name}". Log in as alex@example.com, jordan@example.com or sam@example.com with password: password123`);
}

main().finally(() => prisma.$disconnect());
