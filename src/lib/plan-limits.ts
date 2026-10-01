// THE ONE FILE THAT HOLDS THE PLAN NUMBERS.
//
// Every limit in this app is written here once and nowhere else: the services ask this file before
// they let a company add another project, another person or another file, and the Billing screen
// draws its meters from the same numbers. Change a number here and the whole app changes with it —
// there is no second copy in a component, a message or a database column.
//
// THE NUMBERS ARE SETTLED. The owner decided them on 30 September 2026 (docs/decisions/
// owner-answers-2026-09-30.md, item 1): Free is 1 project / 10 office staff / 10 contractors /
// 500 MB, Pro is unlimited projects / 100 office staff / 50 contractors / 10 GB, and the monthly AI
// allowance is $2 on Free and $25 on Pro. Pro is ONE flat price (`PRO_PRICE` below): people and
// contractors never change what is charged. **Contractors are free** — they never count as office
// staff — but they have a safety ceiling of their own so "free" cannot be abused. Changing any of
// these is an edit to THIS FILE and nothing else — no migration, no re-wording, no test rewrite. The
// Billing screen, the public pricing page and every refusal read them from here.
//
// Nothing about usage is stored, with ONE exception: AI spend. Projects, people and stored bytes are
// counted from the rows themselves at write time and at read time, the same way OVERDUE and a locked
// phase are derived; tokens spent at an outside provider cannot be recovered from anything else, so
// `AiUsage` (see src/server/services/ai.ts) keeps a running total per company per month.

import { PlanSchema, type PlanLimitsDTO, type PlanName, type RoleName } from "@/lib/zod-schemas";

/**
 * What each plan allows. `null` means unlimited — never 0, never a very large number, so "no
 * ceiling" can never be confused with "a ceiling nobody has reached yet".
 *
 * `users` means OFFICE STAFF (active, not a contractor) and `contractors` means active contractors
 * whose access has not ended; the two are counted separately and neither adds to the other. On both
 * plans they are real numbers: `null` is legal in the type but nothing uses it for either.
 *
 * **THE ONE EXCEPTION is `aiMonthlyUsd`**, the monthly AI allowance in US dollars. It is never
 * `null`: AI costs real money per use, so no plan may be uncapped by accident. `0` means "this plan
 * has no AI allowance" (Ask Tielora refuses and the AI-written briefs go out without a summary).
 * FREE = $2 and PRO = $25 are the owner's numbers (30 Sep 2026).
 */
export const PLANS: Record<PlanName, PlanLimitsDTO> = {
  FREE: {
    projects: 1,
    users: 10,
    contractors: 10,
    documentBytes: 500 * 1024 * 1024,
    aiMonthlyUsd: 2,
  },
  PRO: {
    projects: null,
    users: 100,
    contractors: 50,
    documentBytes: 10 * 1024 ** 3,
    aiMonthlyUsd: 25,
  },
};

/**
 * What Pro costs, written once. **Owner-approved on 1 September 2026** — this is the real price,
 * no longer the placeholder the limits above still are. Changing it later is an edit to this line
 * and nothing else.
 *
 * It lives here rather than in a component because three screens show it — Admin → Billing, the
 * public `/pricing` page and the landing page's pricing teaser — and this file's own law is the
 * reason: the whole app changes with the number, there is no second copy. The string carries its
 * own period ("/month"), so a screen shows it as it is and never adds one.
 */
export const PRO_PRICE = "USD $249/month";

/** What a company gets before anybody pays for anything — the column's own default. */
export const DEFAULT_PLAN: PlanName = "FREE";

/**
 * Reads a company's stored plan defensively: anything this build does not recognise — a plan name
 * from a newer version, a typo, a blank — reads as FREE. That is the same defensiveness
 * `broadcastPolicyOf()` carries, applied in the safe direction: an unreadable value can never hand
 * a company limits nobody paid for.
 */
export function planOf(org: { plan?: unknown } | null | undefined): PlanName {
  const parsed = PlanSchema.safeParse(org?.plan);
  return parsed.success ? parsed.data : DEFAULT_PLAN;
}

/** What this company's plan allows. */
export function limitsFor(plan: PlanName): PlanLimitsDTO {
  return PLANS[plan];
}

/**
 * The four things a plan puts a ceiling on (the AI allowance is judged by `ai.ts`, in dollars).
 * `users` is OFFICE STAFF — the name is kept to avoid churn — and `contractors` is its own count.
 */
export type LimitKind = "projects" | "users" | "contractors" | "documentBytes";

/* ------------------------------------------------------------------ */
/* Plain English                                                       */
/* ------------------------------------------------------------------ */

/** "412 MB", "1.4 GB", "10 GB" — a size somebody can judge their own storage by. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${trim(mb < 10 ? mb.toFixed(1) : String(Math.round(mb)))} MB`;
  return `${trim((mb / 1024).toFixed(1))} GB`;
}

/** "10.0" reads as "10" — a round number should look round. */
function trim(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/** What this limit is called on screen: "Projects", "Office staff", "Contractors", "Documents". */
export function limitLabel(kind: LimitKind): string {
  if (kind === "projects") return "Projects";
  if (kind === "users") return "Office staff";
  if (kind === "contractors") return "Contractors";
  return "Documents";
}

/** A limit as a sentence fragment: "1 project", "10 office staff", "10 contractors", "500 MB of documents". */
export function limitAmount(kind: LimitKind, limit: number | null): string {
  if (limit === null) return unlimitedAmount(kind);
  if (kind === "documentBytes") return `${formatBytes(limit)} of documents`;
  if (kind === "projects") return `${limit} ${limit === 1 ? "project" : "projects"}`;
  if (kind === "contractors") return `${limit} ${limit === 1 ? "contractor" : "contractors"}`;
  return `${limit} office staff`;
}

/** The same fragment when there is no ceiling: "unlimited projects". */
function unlimitedAmount(kind: LimitKind): string {
  if (kind === "documentBytes") return "unlimited documents";
  if (kind === "projects") return "unlimited projects";
  return kind === "users" ? "unlimited office staff" : "unlimited contractors";
}

/** Just the amount, with no noun: "1", "10", "500 MB", "Unlimited" — for the plans comparison. */
export function limitShort(kind: LimitKind, limit: number | null): string {
  if (limit === null) return "Unlimited";
  return kind === "documentBytes" ? formatBytes(limit) : String(limit);
}

/** How much of this limit is used, as a percentage. Unlimited is always 0 — there is no bar to fill. */
export function usagePct(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** True when a company is already past this limit — grandfathered data, never blocked from reading. */
export function isOverLimit(used: number, limit: number | null): boolean {
  return limit !== null && used > limit;
}

/* ------------------------------------------------------------------ */
/* The refusal                                                         */
/* ------------------------------------------------------------------ */

/**
 * The plain-English refusal a service gives when a limit is reached, written ONCE here so every
 * screen shows the same words. The server writes it in full — including the role branch — and the
 * screens show it exactly as it arrives; nothing is ever re-worded in a component.
 *
 * The role branch is the server's call, not a screen's: an administrator is pointed at the Billing
 * page, and everybody else is told who to ask. The pointer is written as words rather than a link
 * because a refusal travels as a plain string all the way from the service to `ErrorBanner` — the
 * moment a component had to turn part of it into a link, it would be re-wording the server.
 */
export function limitRefusal(kind: LimitKind, plan: PlanName, role: RoleName): string {
  const limit = PLANS[plan][kind];
  const proLimit = PLANS.PRO[kind];

  const first = `Your plan has room for ${limitAmount(kind, limit)}.`;
  const includes =
    plan === "FREE"
      ? `Free plans include ${limitShort(kind, limit)}`
      : `Pro plans include ${limitShort(kind, limit)}`;
  // Only a FREE company has somewhere to upgrade to, and only when Pro is genuinely roomier.
  const upgrade =
    plan === "FREE" && role === "ADMIN"
      ? ` — upgrade to Pro for ${proLimit === null ? "unlimited" : limitShort(kind, proLimit)}`
      : "";

  // The two people groups say what does NOT count, and on Pro there is nowhere higher to go, so the
  // administrator is told how to make room instead of being pointed at plans.
  if (kind === "users" || kind === "contractors") {
    const doesNotCount =
      kind === "users"
        ? "Outside contractors don't count."
        : "Deactivated contractors, and ones whose access has ended, don't count.";
    let pointer: string;
    if (role === "ADMIN") {
      pointer =
        plan === "FREE"
          ? "See plans in Admin → Billing."
          : kind === "users"
            ? "Deactivate someone who no longer needs to sign in to make room."
            : "Deactivate one you no longer work with, or let their access end, to make room.";
    } else {
      pointer =
        plan === "FREE"
          ? "Ask your administrator to upgrade your plan."
          : "Ask your administrator to make room.";
    }
    return `${first} ${includes}${upgrade}. ${doesNotCount} ${pointer}`;
  }

  const pointer =
    role === "ADMIN"
      ? "See plans in Admin → Billing."
      : "Ask your administrator to upgrade your plan.";

  return `${first} ${includes}${upgrade}. ${pointer}`;
}
