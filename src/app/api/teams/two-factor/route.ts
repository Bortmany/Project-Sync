// The second step for the Teams tab: a thin twin of `/api/auth/two-factor`. ONE shared
// implementation (src/server/two-factor-step.ts) — this route's door is the tab, so the finished
// sign-in sets `tielora_teams` instead of `nexus_session`, and the LOGIN row says `via: "teams"`.
// The door is chosen here, in code, never by a field in the request body. It shares the ticket
// budget (5 tries) and the per-account budget (8 per 15 minutes) with the browser route, so the tab
// is not a second, free place to guess codes.

import { byIp, limit } from "@/lib/rate-limit";
import { TEAMS_NOT_SET_UP, teamsAppConfig } from "@/lib/teams-app";
import { fail } from "@/server/http";
import { runTwoFactorStep, tooMany } from "@/server/two-factor-step";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!teamsAppConfig()) return fail(TEAMS_NOT_SET_UP, 503);

  // The tab's own address budget, 20 a minute; the ticket and per-account budgets are the browser
  // route's own, shared through runTwoFactorStep().
  const throttle = limit(byIp(request, "two-factor-teams"), 20, 60_000);
  if (!throttle.ok) {
    return tooMany("Too many attempts. Please wait a minute and try again.", throttle.retryAfterSec);
  }
  return runTwoFactorStep(request, "teams");
}
