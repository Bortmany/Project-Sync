// Next.js calls register() once when the server starts. It is the only place background work is
// started, and it only ever runs in the Node.js runtime — never in the edge runtime, never in the
// browser bundle.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startSweep } = await import("@/server/sweep");
  startSweep();
}
