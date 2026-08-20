// Vitest setup: point the Prisma client at the test database before anything imports it.
// The library tests do not touch the database at all, so this is harmless for them.

import "dotenv/config";

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is not set. Copy .env.example to .env and fill it in.");
}

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
