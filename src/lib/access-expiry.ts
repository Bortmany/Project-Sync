// Contractor access expiry: one pure rule, used by the sign-in gate, the admin screens and the
// hourly sweep, so all three agree on what "expired" means.
//
// "Expired" is never stored. It is derived from `User.accessExpiresAt` at read time, exactly as
// OVERDUE is derived from a deadline (`isOverdue()` in src/lib/progress.ts) — there is no expired
// column and there must never be one.

import type { RoleName } from "@/lib/zod-schemas";

/** One day, in milliseconds — the grace the access-end day itself gets, exactly as a deadline does. */
export const ACCESS_EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

const DAY_MS = ACCESS_EXPIRY_GRACE_MS;

/** How far ahead the sweep looks when it warns administrators that a contractor's access is ending. */
export const ACCESS_EXPIRY_WARNING_MS = 7 * DAY_MS;

export type AccessLimited = { role: RoleName; accessExpiresAt?: Date | null };

/**
 * True once a contractor's access has run out.
 *
 * The date is stored at UTC midnight, the same way every other date in this app is, and means "the
 * last day they may work" — so somebody whose access ends 30 Sep is still let in on 30 Sep and
 * refused from 1 Oct, which is what the admin screen's hint promises ("after this date they're
 * locked out"). It is the same one-day grace a deadline gets.
 *
 * Only an EXTERNAL contractor is ever limited this way: no other role carries a date, and if an old
 * one somehow survived a role change it is ignored rather than locking a colleague out.
 */
export function isAccessExpired(user: AccessLimited, now: Date = new Date()): boolean {
  if (user.role !== "EXTERNAL" || !user.accessExpiresAt) return false;
  return user.accessExpiresAt.getTime() + DAY_MS <= now.getTime();
}
