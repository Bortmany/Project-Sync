// Admin → Billing: where an administrator sees the company's plan and how close it is to that
// plan's limits.
//
// A SERVER COMPONENT, deliberately: the whole page is a read, and the only client code on it is the
// small island in admin-billing-actions.tsx — the two buttons and the strip somebody sees after
// paying. While no payment provider is set up there are no buttons at all: not greyed out, not
// disabled with a tooltip, simply absent, the same discipline the Microsoft card follows.
//
// Every number here is counted at read time by billingStatus(); nothing about usage is stored.
//
// WHAT THIS SCREEN DELIBERATELY DOES NOT SAY: a renewal date, an amount, a card, an invoice. None
// of it is stored in this app — the provider holds it, and "Manage billing" is the door to it. The
// copy below says so rather than inventing a date it cannot know.

import { BillingButtons, BillingReturnStrip } from "@/components/admin/admin-billing-actions";
import { Badge, Card, ProgressBar } from "@/components/ui";
import {
  PLANS,
  PRO_PRICE,
  formatBytes,
  isOverLimit,
  limitAmount,
  limitShort,
  usagePct,
  type LimitKind,
} from "@/lib/plan-limits";
import type { BillingStatusDTO, PlanName } from "@/lib/zod-schemas";

/**
 * What each plan includes, in the order the meters below run — BUILT FROM `PLANS`, never typed out.
 * A number written here as words would be a second copy of a limit, and the promise in
 * docs/GO-LIVE.md is that changing a limit is an edit to `src/lib/plan-limits.ts` and nothing else.
 */
const INCLUDES: Record<PlanName, string[]> = {
  FREE: includesFor("FREE"),
  PRO: includesFor("PRO"),
};

function includesFor(plan: PlanName): string[] {
  const limits = PLANS[plan];
  const people = limits.users === null ? limitAmount("users", null) : `Up to ${limitAmount("users", limits.users)}`;
  return [
    capitalise(limitAmount("projects", limits.projects)),
    capitalise(people),
    capitalise(limitAmount("documentBytes", limits.documentBytes)),
  ];
}

/** "unlimited projects" reads as "Unlimited projects" at the start of a bullet. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The calm, nothing-has-gone-wrong note — the same tone Data & privacy uses. */
function CalmNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]">
      {children}
    </p>
  );
}

/**
 * One usage meter. With a limit it is a bar and a count; on an unlimited plan it is a plain count
 * with no bar and no denominator — a bar implying a ceiling that is not there would be misleading.
 */
function Meter({
  label,
  kind,
  used,
  limit,
}: {
  label: string;
  kind: LimitKind;
  used: number;
  limit: number | null;
}) {
  const shown = kind === "documentBytes" ? formatBytes(used) : String(used);
  const over = isOverLimit(used, limit);

  if (limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-[var(--brand-text)]">{label}</span>
        <span className="text-sm tabular-nums text-[var(--brand-ink)]">
          {kind === "documentBytes" ? `${shown} used` : `${shown} ${label.toLowerCase()}`}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-[var(--brand-text)]">{label}</span>
        <span
          className="text-sm tabular-nums"
          style={{ color: over ? "var(--status-blocked)" : "var(--brand-ink)" }}
        >
          {shown} / {kind === "documentBytes" ? formatBytes(limit) : limit}
        </span>
      </div>
      {/* Over the limit, the bar itself is the signal — no extra badge, the same restraint the rest
          of the app uses for "blocked". */}
      <span className="inline-flex w-full items-center">
        {over ? (
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--brand-gray)]/40">
            <span
              className="block h-full rounded-full bg-[var(--status-blocked)]"
              style={{ width: "100%" }}
            />
          </span>
        ) : (
          <ProgressBar pct={usagePct(used, limit)} />
        )}
      </span>
      {over ? (
        <p className="text-xs text-[var(--status-blocked)]">
          You have more than your plan&rsquo;s limit — nothing is at risk, but you can&rsquo;t add
          another until you&rsquo;re back under, or you upgrade.
        </p>
      ) : null}
    </div>
  );
}

function CurrentPlanCard({ status }: { status: BillingStatusDTO }) {
  const pro = status.plan === "PRO";

  return (
    <Card
      title="Your plan"
      action={
        pro ? (
          <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
            PRO
          </Badge>
        ) : (
          <Badge color="var(--brand-gray)">FREE</Badge>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-ink)]">Includes:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--brand-text)]">
            {INCLUDES[status.plan].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <Meter
            label="Projects"
            kind="projects"
            used={status.usage.projects}
            limit={status.limits.projects}
          />
          <Meter label="People" kind="users" used={status.usage.users} limit={status.limits.users} />
          <Meter
            label="Documents"
            kind="documentBytes"
            used={status.usage.documentBytes}
            limit={status.limits.documentBytes}
          />
        </div>

        {status.provider.configured ? (
          <div className="space-y-3">
            {/* A failed payment is the one thing our own rows can honestly report, and only from
                the last webhook we were sent. Nothing changes about the plan while the provider is
                still trying. */}
            {pro && status.provider.paymentIssue ? (
              <p className="text-sm text-[var(--status-blocked)]">
                Your last payment didn&rsquo;t go through. We&rsquo;re trying again automatically —
                your Pro plan is not affected yet. Manage billing to update your card.
              </p>
            ) : null}

            {pro ? (
              <p className="text-sm text-[var(--brand-text)]">
                Your subscription is looked after by our payment provider. Manage billing opens your
                own page there, where your next payment date, your invoices and your card live — we
                don&rsquo;t keep any of that here.
              </p>
            ) : null}

            <BillingButtons plan={status.plan} hasSubscription={status.provider.hasSubscription} />
          </div>
        ) : (
          /* DORMANT: no payment provider is set up on this Tielora, so there is nothing to press.
             The plan and the meters above still show — an administrator should always be able to
             see where they stand. */
          <CalmNote>
            Upgrading isn&rsquo;t turned on for this Tielora yet. Nothing else about your plan
            changes in the meantime.
          </CalmNote>
        )}
      </div>
    </Card>
  );
}

/** One row of the FREE / PRO comparison. */
function PlansRow({ label, free, pro }: { label: string; free: string; pro: string }) {
  return (
    <>
      <div className="border-t border-[var(--border)] py-2 text-sm text-[var(--brand-text)]">
        {label}
      </div>
      <div className="border-t border-[var(--border)] py-2 text-sm text-[var(--brand-ink)]">
        {free}
      </div>
      <div className="border-t border-[var(--border)] py-2 text-sm text-[var(--brand-ink)]">
        {pro}
      </div>
    </>
  );
}

function PlansCard({ plan }: { plan: BillingStatusDTO["plan"] }) {
  return (
    <Card title="Plans">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4">
        <div className="py-2" />
        <div className="py-2 text-xs font-semibold text-[var(--brand-gray)]">FREE</div>
        <div className="py-2 text-xs font-semibold text-[var(--brand-gray)]">PRO</div>

        <PlansRow
          label="Projects"
          free={limitShort("projects", PLANS.FREE.projects)}
          pro={limitShort("projects", PLANS.PRO.projects)}
        />
        <PlansRow
          label="People"
          free={`Up to ${limitShort("users", PLANS.FREE.users)}`}
          pro={limitShort("users", PLANS.PRO.users)}
        />
        <PlansRow
          label="Documents"
          free={limitShort("documentBytes", PLANS.FREE.documentBytes)}
          pro={limitShort("documentBytes", PLANS.PRO.documentBytes)}
        />
        {/* On Pro, the Pro column says so instead of repeating a price nobody is about to pay. */}
        <PlansRow label="Price" free="Free" pro={plan === "PRO" ? "Your plan" : PRO_PRICE} />
      </div>
    </Card>
  );
}

export function AdminBillingView({
  status,
  outcome,
}: {
  status: BillingStatusDTO;
  /** What the return from checkout put in the address bar. Only "success" means anything. */
  outcome?: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Billing</h1>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Your company&rsquo;s plan and how much of it you are using. Everything you already have
          keeps working — a plan only ever decides how much more you can add.
        </p>
      </div>

      {/* Coming back from a cancelled or abandoned checkout shows nothing at all: the card is
          simply still there, exactly as if the button had never been pressed. */}
      {outcome === "success" ? <BillingReturnStrip plan={status.plan} /> : null}

      <div className="max-w-2xl space-y-8">
        <CurrentPlanCard status={status} />
        <PlansCard plan={status.plan} />
      </div>
    </div>
  );
}
