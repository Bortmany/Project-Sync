// THE ONE FILE THAT HOLDS THE PLAN NUMBERS.
//
// Every limit in this app is written here once and nowhere else: the services ask this file before
// they let a company add another project, another person or another file, and the Billing screen
// draws its meters from the same numbers. Change a number here and the whole app changes with it —
// there is no second copy in a component, a message or a database column.
//
// PLACEHOLDER NUMBERS — with one exception. The three FREE limits and the PRO storage cap are
// still the roadmap's placeholders; THE OWNER SETS THE REAL NUMBERS at the pause point before this
// goes live. **The price is settled**: `PRO_PRICE` below is the owner's approved figure (approved
// 1 September 2026), not a placeholder any more. Changing any of these is an edit to THIS FILE and
// nothing else — no migration, no re-wording, no test rewrite. The Billing screen and the public
// pricing page both read them from here.
//
// Nothing about usage is stored. Projects, people and stored bytes are counted from the rows
// themselves at write time and at read time, the same way OVERDUE and a locked phase are derived.

import { PlanSchema, type PlanLimitsDTO, type PlanName, type RoleName } from "@/lib/zod-schemas";

/**
 * What each plan allows. `null` means unlimited — never 0, never a very large number, so "no
 * ceiling" can never be confused with "a ceiling nobody has reached yet".
 */
export const PLANS: Record<PlanName, PlanLimitsDTO> = {
  FREE: {
    projects: 1,
    users: 10,
    documentBytes: 500 * 1024 * 1024,
  },
  PRO: {
    projects: null,
    users: null,
    documentBytes: 10 * 1024 ** 3,
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

/** The three things a plan puts a ceiling on. */
export type LimitKind = "projects" | "users" | "documentBytes";

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

/** What this limit is called on screen: "Projects", "People", "Documents". */
export function limitLabel(kind: LimitKind): string {
  if (kind === "projects") return "Projects";
  if (kind === "users") return "People";
  return "Documents";
}

/** A limit as a sentence fragment: "1 project", "10 people", "500 MB of documents". */
export function limitAmount(kind: LimitKind, limit: number | null): string {
  if (limit === null) return unlimitedAmount(kind);
  if (kind === "documentBytes") return `${formatBytes(limit)} of documents`;
  if (kind === "projects") return `${limit} ${limit === 1 ? "project" : "projects"}`;
  return `${limit} ${limit === 1 ? "person" : "people"}`;
}

/** The same fragment when there is no ceiling: "unlimited projects". */
function unlimitedAmount(kind: LimitKind): string {
  if (kind === "documentBytes") return "unlimited documents";
  return kind === "projects" ? "unlimited projects" : "unlimited people";
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
  const pointer =
    role === "ADMIN"
      ? "See plans in Admin → Billing."
      : "Ask your administrator to upgrade your plan.";

  return `${first} ${includes}${upgrade}. ${pointer}`;
}
