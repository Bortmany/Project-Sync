// Next.js calls register() once when the server starts. It is the only place background work is
// started, and it only ever runs in the Node.js runtime — never in the edge runtime, never in the
// browser bundle.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Refuse to run in production with a weak SESSION_SECRET or an unusable DATA_DIR. register()
  // only runs when a server starts, never during `next build` — which is why the DATA_DIR half of
  // the guards lives here and not at import time.
  const { assertBootEnv } = await import("@/lib/boot-guards");
  assertBootEnv();

  // Error tracking stays completely inert unless SENTRY_DSN is set.
  const { initErrorReporting } = await import("@/lib/error-reporting");
  await initErrorReporting();

  const { startSweep } = await import("@/server/sweep");
  startSweep();
}

// Next.js reports every uncaught server error here — logged always, sent on when Sentry is keyed.
export { onRequestError } from "@/lib/error-reporting";
