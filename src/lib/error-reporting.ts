// Error tracking, dormant by default. Sentry is only loaded and started when SENTRY_DSN is set;
// with no DSN nothing is imported, nothing is sent, and the app behaves exactly as before.
// /api/health reports the state of both channels: the server (SENTRY_DSN) and the browser
// (NEXT_PUBLIC_SENTRY_DSN), which are switched on independently.

import { logger } from "@/lib/logger";

export type SentryChannelStatus = "dormant" | "configured";

/** Both error-tracking channels, exactly as /api/health reports them. */
export type SentryStatus = {
  server: SentryChannelStatus;
  browser: SentryChannelStatus;
};

/** Which error-tracking channels are switched on — what /api/health reports. */
export function sentryStatus(): SentryStatus {
  return {
    server: process.env.SENTRY_DSN ? "configured" : "dormant",
    browser: process.env.NEXT_PUBLIC_SENTRY_DSN ? "configured" : "dormant",
  };
}

// The Content-Security-Policy needs the DSN's ingest origin too, but next.config.ts is loaded
// before the app's module aliases exist, so it parses the DSN itself. Keep the two in step.

/** Loaded once per process, and only when a DSN exists. */
type SentryModule = typeof import("@sentry/nextjs");
let sentryPromise: Promise<SentryModule | null> | null = null;

async function loadSentry(): Promise<SentryModule | null> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  sentryPromise ??= import("@sentry/nextjs")
    .then((sentry) => {
      sentry.init({
        dsn,
        // Errors only by default. Turn tracing up deliberately, not by accident.
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
        environment: process.env.NODE_ENV,
        // sendDefaultPii: false stops Sentry *adding* extra personal data, but this SDK still
        // attaches the request's cookies and headers on its own. So say it explicitly per category.
        sendDefaultPii: false,
        dataCollection: {
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          userInfo: false,
        },
        // Belt and braces: whatever the SDK version does, nothing leaves here with request
        // headers or cookies attached.
        beforeSend(event) {
          if (event.request) {
            delete event.request.headers;
            delete event.request.cookies;
          }
          return event;
        },
      });
      logger.info("Error tracking started", { provider: "sentry" });
      return sentry;
    })
    .catch((error) => {
      logger.warn("Error tracking could not start; continuing without it", { error });
      return null;
    });

  return sentryPromise;
}

/** Called once at boot from src/instrumentation.ts. A no-op when SENTRY_DSN is unset. */
export async function initErrorReporting(): Promise<void> {
  await loadSentry();
}

/** Reports a server-side error. Always logs; also sends to Sentry when it is configured. */
export async function reportError(
  message: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  logger.error(message, { ...context, error });
  const sentry = await loadSentry();
  sentry?.captureException(error, { extra: { message, ...context } });
}

/**
 * Next.js calls this for every uncaught error in a server component, route handler or server
 * action. Re-exported from src/instrumentation.ts, which is where Next looks for it.
 */
export async function onRequestError(
  ...args: Parameters<SentryModule["captureRequestError"]>
): Promise<void> {
  const [error, request] = args;
  logger.error("Unhandled server error", {
    path: request.path,
    method: request.method,
    error,
  });
  const sentry = await loadSentry();
  sentry?.captureRequestError(...args);
}
