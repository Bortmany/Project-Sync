// The Node.js-only half of instrumentation.ts. Kept in its own file so the edge/instrumentation
// bundle never has to follow these imports (the sweep reaches the database driver, which needs
// Node's `fs`). Only ever imported behind the NEXT_RUNTIME === "nodejs" check.

export async function registerNode(): Promise<void> {
  // Refuse to run in production with a weak SESSION_SECRET or an unusable DATA_DIR. This only runs
  // when a server starts, never during `next build` — which is why the DATA_DIR half of the guards
  // lives here and not at import time.
  const { assertBootEnv } = await import("@/lib/boot-guards");
  assertBootEnv();

  // Error tracking stays completely inert unless SENTRY_DSN is set.
  const { initErrorReporting } = await import("@/lib/error-reporting");
  await initErrorReporting();

  const { startSweep } = await import("@/server/sweep");
  startSweep();
}
