// The typed errors services throw, and the one place they become the app's ActionResult failure shape.

import { ForbiddenError } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/zod-schemas";

/** Something the person asked for is not allowed by the rules — the message is shown to them as-is. */
export class ServiceError extends Error {
  readonly code = "SERVICE_ERROR" as const;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ServiceError";
    this.fieldErrors = fieldErrors;
  }
}

/** The thing asked for does not exist, or the person may not know that it does. */
export class NotFoundError extends ServiceError {
  constructor(message = "We could not find that.") {
    super(message);
    this.name = "NotFoundError";
  }
}

const GENERIC = "Something went wrong on our side. Please try again.";

/** Turns any thrown error into the standard failure result, in plain English and without leaking internals. */
export function toFailure(error: unknown, context: Record<string, unknown> = {}): ActionResult<never> {
  if (error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof ServiceError) {
    return error.fieldErrors
      ? { ok: false, error: error.message, fieldErrors: error.fieldErrors }
      : { ok: false, error: error.message };
  }
  logger.error("Unhandled failure in a server action", { ...context, error });
  return { ok: false, error: GENERIC };
}

/** The HTTP status that matches a thrown error, for route handlers. */
export function statusFor(error: unknown): number {
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ServiceError) return 400;
  return 500;
}
