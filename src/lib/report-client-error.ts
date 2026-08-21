// Browser-side error reporting, dormant by default.
//
// The server reads SENTRY_DSN; the browser can only ever see NEXT_PUBLIC_SENTRY_DSN, so browser
// reporting stays off until that second variable is set deliberately (see docs/GO-LIVE.md). With it
// unset, nothing is loaded and nothing leaves the browser — the error boundary just shows its
// plain-English screen.

let started = false;

export function reportClientError(error: unknown): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  void import("@sentry/nextjs")
    .then((sentry) => {
      if (!started) {
        sentry.init({ dsn, tracesSampleRate: 0, sendDefaultPii: false });
        started = true;
      }
      sentry.captureException(error);
    })
    .catch(() => {
      // Reporting must never make a bad screen worse.
    });
}
