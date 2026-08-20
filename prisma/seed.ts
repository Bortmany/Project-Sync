// Seed: the eight engineering disciplines plus one demo administrator. Safe to run more than once.

import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const DISCIPLINES = [
  { code: "MECH", name: "Mechanical", colorHex: "#00558C", sortOrder: 1 },
  { code: "ELEC", name: "Electrical", colorHex: "#5BC2E7", sortOrder: 2 },
  { code: "INST", name: "Instrumentation", colorHex: "#004F71", sortOrder: 3 },
  { code: "CIVIL", name: "Civil", colorHex: "#8A8D6A", sortOrder: 4 },
  { code: "PROC", name: "Process", colorHex: "#003E51", sortOrder: 5 },
  { code: "HSE", name: "HSE", colorHex: "#3E7A5E", sortOrder: 6 },
  { code: "REL", name: "Reliability", colorHex: "#B08D57", sortOrder: 7 },
  { code: "INSP", name: "Inspection", colorHex: "#7A6A8A", sortOrder: 8 },
];

// Demo credentials for local development only — never use these anywhere real.
const ADMIN_EMAIL = "admin@omanlng.example";
const ADMIN_PASSWORD = "Nexus!Demo2026";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  for (const discipline of DISCIPLINES) {
    await prisma.discipline.upsert({
      where: { code: discipline.code },
      update: { name: discipline.name, colorHex: discipline.colorHex, sortOrder: discipline.sortOrder },
      create: discipline,
    });
  }

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", isActive: true },
    create: {
      email: ADMIN_EMAIL,
      name: "Nexus Administrator",
      passwordHash,
      role: "ADMIN",
      jobTitle: "System administrator",
    },
  });

  process.stdout.write(
    `Seeded ${DISCIPLINES.length} disciplines and the demo administrator (${ADMIN_EMAIL}).\n`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
