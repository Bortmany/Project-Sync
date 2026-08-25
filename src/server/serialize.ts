// One small guard used by every serializer: outside production, prove the object really matches its contract.

import type { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * Checks a built DTO against its schema in development and test, and returns it unchanged.
 * In production the check is skipped — the contract is already proven by the test suite.
 */
export function checkDto<T>(schema: z.ZodType<T>, value: T, label: string): T {
  if (process.env.NODE_ENV === "production") return value;

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    logger.error("A serializer produced something outside its contract", {
      label,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    throw new Error(`${label} did not match its contract.`);
  }
  return value;
}

/** Same check for a list, without logging one line per row. */
export function checkDtoList<T>(schema: z.ZodType<T>, values: T[], label: string): T[] {
  if (process.env.NODE_ENV === "production") return values;
  for (const value of values) checkDto(schema, value, label);
  return values;
}
