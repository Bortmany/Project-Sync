// The second half of signing in: the six digits from an authenticator app, or one recovery code.
//
// Four rules govern this route:
//  1. **The pending token alone is never a way in.** It only says a password was accepted less than
//     five minutes ago; a session exists only once the second factor has been proved as well.
//  2. **A miss never says why.** A wrong code, a wrong recovery code, an expired ticket, a spent
//     ticket and one that never existed all answer the same sentence with the same status.
//  3. **Everything lands together.** Spending the ticket, spending a recovery code, creating the
//     session, stamping lastLoginAt and appending the LOGIN row are one transaction; the cookie is
//     only set after it commits.
//  4. **These limiters are their own.** Wrong codes count against this ticket and this account's
//     second step — never against the password limiter, which would let somebody guessing codes
//     lock the real owner out of the sign-in form.

import { byIp, limit } from "@/lib/rate-limit";
import { runTwoFactorStep, tooMany } from "@/server/two-factor-step";

// The implementation is shared with the Teams tab's `/api/teams/two-factor` — see
// src/server/two-factor-step.ts. This route's door is the browser: it sets `nexus_session`.
export async function POST(request: Request) {
  const throttle = limit(byIp(request, "two-factor"), 20, 60_000);
  if (!throttle.ok) {
    return tooMany("Too many attempts. Please wait a minute and try again.", throttle.retryAfterSec);
  }
  return runTwoFactorStep(request, "browser");
}
