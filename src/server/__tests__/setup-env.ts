// Vitest setup: point the Prisma client at the test database before anything imports it.
// The library tests do not touch the database at all, so this is harmless for them.

import "dotenv/config";

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is not set. Copy .env.example to .env and fill it in.");
}

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

// The route tests hand in X-Forwarded-For to tell one caller from another, the way Railway does
// in front of the real app. The rate limiter only reads that header behind a trusted proxy, so the
// test run declares itself one. The limiter's own unit test passes its env explicitly and ignores this.
if (!process.env.TRUST_PROXY) process.env.TRUST_PROXY = "1";
