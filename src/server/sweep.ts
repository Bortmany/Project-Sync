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
import { sweepDeadlineNotifications, type SweepCounts } from "@/server/services/notifications";

/** The app's fixed advisory-lock key. Any other scheduled job must pick a different number. */
export const SWEEP_LOCK_KEY = 728_431_001;

/** How often the sweep runs once the server is warm. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** How long after boot the first run happens — long enough for the server to finish starting up. */
export const FIRST_RUN_DELAY_MS = 60_000;

export type SweepResult =
  | { ran: true; counts: SweepCounts }
  | { ran: false; reason: "another instance is running it" };

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
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}::bigint) AS locked`;

      if (!rows[0]?.locked) return { ran: false, reason: "another instance is running it" as const };

      const counts = await sweepDeadlineNotifications(tx, now);
      return { ran: true as const, counts };
    },
    // A sweep walks every open task in every project, so the default five-second budget is far
    // too short once there is real data: two minutes to finish, ten seconds to wait for a slot.
    { timeout: 120_000, maxWait: 10_000 },
  );
}

type SweepGlobal = { nexusSweepStarted?: boolean };

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
        if (result.ran) {
          const total = result.counts.approaching + result.counts.overdue;
          if (total > 0) logger.info("Deadline sweep sent notifications", { ...result.counts });
        }
      })
      .catch((error) => logger.error("The deadline sweep could not finish", { error }));
  };

  setTimeout(run, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();

  logger.info("Deadline sweep scheduled", { everyMinutes: SWEEP_INTERVAL_MS / 60_000 });
}
