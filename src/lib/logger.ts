// Structured JSON logger with secret redaction — the only place the app writes to the console.

type Level = "info" | "warn" | "error";

const SECRET_KEY = /password|token|secret|cookie|authorization/i;
const REDACTED = "[redacted]";

/** Deep-copies a value, replacing anything under a secret-looking key with "[redacted]". */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};

export { redact as redactForLog };
