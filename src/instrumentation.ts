// Next.js calls register() once when the server starts. It is the only place background work is
// started, and it only ever runs in the Node.js runtime — never in the edge runtime, never in the
// browser bundle.

export async function register(): Promise<void> {
  // The positive form of the check is the one Next.js documents: it lets the bundler leave the
  // Node-only file out of the edge build entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}

// Next.js reports every uncaught server error here — logged always, sent on when Sentry is keyed.
export { onRequestError } from "@/lib/error-reporting";
