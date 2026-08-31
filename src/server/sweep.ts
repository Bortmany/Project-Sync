// The overdue sweep: once an hour, look for deadlines that are close or past and tell the people
// responsible. Started from src/instrumentation.ts, in the Node runtime only.
//
// Two safety rules govern this file:
//  1. Several copies of the app may run at once, so every run first takes a Postgres advisory lock
//     and simply skips if another copy already holds it (engineering standards, section 5).
//  2. Nothing in the app depends on the sweep having run. "Overdue" is derived at read time
//     everywhere (`isOverdue()`); a skipped run costs a nudge, never correctness.

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  sweepDeadlineNotifications,
  type SweepCounts,
  type SweepWebhookEvent,
} from "@/server/services/notifications";
import { deliverToOrgWebhooks } from "@/server/services/webhooks";

/** The app's fixed advisory-lock key. Any other scheduled job must pick a different number. */
export const SWEEP_LOCK_KEY = 728_431_001;

/** How often the sweep runs once the server is warm. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** How long after boot the first run happens — long enough for the server to finish starting up. */
export const FIRST_RUN_DELAY_MS = 60_000;

export type SweepResult =
  | { ran: true; counts: SweepCounts }
  | { ran: false; reason: "another instance is running it" };

/**
 * The most reminders one company's chat channel receives from a single sweep. A quiet cap, not a
 * queue: chat webhooks are rate limited at roughly one message a second, and a company with two
 * hundred overdue tasks wants a look at its dashboard, not two hundred cards. The in-app
 * notifications are all written either way — they are the truth.
 */
export const MAX_CHAT_REMINDERS_PER_ORG = 20;

/**
 * The longest the whole chat step may take, across every company, in one sweep. A single message
 * can cost five seconds of timeout and a ten-second rate-limit wait, so this is what stops a bad
 * afternoon at Slack from keeping an hourly job busy for minutes.
 */
export const CHAT_DELIVERY_BUDGET_MS = 30_000;

/** True when SWEEP_DISABLED=1 — set in the tests and available as a kill switch in production. */
export function sweepDisabled(): boolean {
  return process.env.SWEEP_DISABLED === "1";
}

/**
 * One pass of the sweep, guarded by the advisory lock.
 *
 * The lock is taken with `pg_try_advisory_xact_lock` inside the same transaction that does the work:
 * a transaction-scoped lock is always released when the transaction ends — commit, rollback or a
 * dropped connection — which a session-scoped lock cannot promise behind a connection pool.
 *
 * Deliberately does NOT check SWEEP_DISABLED: that switch stops the scheduler, while the tests call
 * this function directly.
 */
export async function runSweepOnce(now: Date = new Date()): Promise<SweepResult> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}::bigint) AS locked`;

      if (!rows[0]?.locked) {
        return { ran: false as const, reason: "another instance is running it" as const };
      }

      const swept = await sweepDeadlineNotifications(tx, now);
      return { ran: true as const, counts: swept.counts, events: swept.events };
    },
    // A sweep walks every open task in every project, so the default five-second budget is far
    // too short once there is real data: two minutes to finish, ten seconds to wait for a slot.
    { timeout: 120_000, maxWait: 10_000 },
  );

  if (!outcome.ran) return outcome;

  // Chat copies go out only after the transaction has committed, exactly as notify() does it: the
  // notification rows are the truth, and a chat tool being slow must never hold a database
  // transaction open.
  await deliverSweepReminders(outcome.events);
  return { ran: true, counts: outcome.counts };
}

/**
 * Posts the sweep's reminders to whichever companies have chat switched on. Never throws.
 *
 * Two limits, both deliberate. The per-company cap keeps one busy company from flooding its own
 * channel; the overall time budget keeps the whole step short — every message may cost five seconds
 * of timeout plus a ten-second wait when a chat tool answers "too many requests", so without a
 * deadline a few dozen slow ones could keep an hourly job busy for minutes. Whatever is held back
 * is only ever a nudge: the notification rows are already committed.
 *
 * The deadline is checked AFTER each send, so at least one message always goes out.
 */
export async function deliverSweepReminders(
  events: SweepWebhookEvent[],
  budgetMs: number = CHAT_DELIVERY_BUDGET_MS,
): Promise<void> {
  if (events.length === 0) return;

  const perOrg = new Map<string, SweepWebhookEvent[]>();
  for (const event of events) {
    const list = perOrg.get(event.orgId) ?? [];
    list.push(event);
    perOrg.set(event.orgId, list);
  }

  const deadline = Date.now() + budgetMs;
  let outOfTime = false;

  for (const [orgId, list] of perOrg) {
    const wanted = list.slice(0, MAX_CHAT_REMINDERS_PER_ORG);
    let sent = 0;

    if (!outOfTime) {
      for (const event of wanted) {
        await deliverToOrgWebhooks(orgId, {
          type: event.type,
          title: event.title,
          body: event.body,
          linkUrl: event.linkUrl,
        });
        sent += 1;
        if (Date.now() >= deadline) {
          outOfTime = true;
          break;
        }
      }
    }

    const heldBack = list.length - sent;
    if (heldBack > 0) {
      logger.info("Chat reminders held back this sweep", {
        orgId,
        sent,
        heldBack,
        reason: outOfTime ? "the time budget for chat ran out" : "the per-company cap",
      });
    }
  }
}

type SweepGlobal = { nexusSweepStarted?: boolean; nexusSweepLast?: SweepReport };

/** What /api/health says about the sweep. Reporting only — nothing in the app reads it. */
export type SweepReport = {
  scheduled: boolean;
  lastRunAt: string | null;
  lastResult: "sent" | "nothing to send" | "skipped — another instance" | "failed" | null;
};

/** The sweep's state in this process, for /api/health. Per-process by design: a report, not a fact. */
export function sweepStatus(): SweepReport {
  const scope = globalThis as unknown as SweepGlobal;
  return (
    scope.nexusSweepLast ?? {
      scheduled: Boolean(scope.nexusSweepStarted),
      lastRunAt: null,
      lastResult: null,
    }
  );
}

function recordRun(result: SweepReport["lastResult"]): void {
  const scope = globalThis as unknown as SweepGlobal;
  scope.nexusSweepLast = {
    scheduled: Boolean(scope.nexusSweepStarted),
    lastRunAt: new Date().toISOString(),
    lastResult: result,
  };
}

/**
 * Starts the hourly sweep — once per process, never during a build, never when SWEEP_DISABLED=1.
 * Any failure is logged and the next hour tries again.
 */
export function startSweep(): void {
  const scope = globalThis as unknown as SweepGlobal;

  if (scope.nexusSweepStarted) return;
  if (sweepDisabled()) {
    logger.info("Deadline sweep is switched off (SWEEP_DISABLED=1)");
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "test") return;

  scope.nexusSweepStarted = true;

  const run = () => {
    void runSweepOnce()
      .then((result) => {
        if (!result.ran) {
          recordRun("skipped — another instance");
          return;
        }
        const total = result.counts.approaching + result.counts.overdue;
        recordRun(total > 0 ? "sent" : "nothing to send");
        if (total > 0) logger.info("Deadline sweep sent notifications", { ...result.counts });
      })
      .catch((error) => {
        recordRun("failed");
        logger.error("The deadline sweep could not finish", { error });
      });
  };

  setTimeout(run, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();

  logger.info("Deadline sweep scheduled", { everyMinutes: SWEEP_INTERVAL_MS / 60_000 });
}
