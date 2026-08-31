// Health check: database reachable, uploads folder writable, whether each error-tracking
// channel (server and browser) is switched on, how the hourly deadline sweep is getting on, and
// how many companies have each chat integration switched on.

import { NextResponse } from "next/server";
import { access, constants, mkdir } from "node:fs/promises";
import { pingDatabase } from "@/lib/db";
import { sentryStatus } from "@/lib/error-reporting";
import { uploadsDir } from "@/lib/upload";
import { integrationCounts } from "@/server/services/integrations";
import { sweepStatus } from "@/server/sweep";

export const dynamic = "force-dynamic";

async function dataDirWritable(): Promise<boolean> {
  try {
    const dir = uploadsDir();
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function integrationCountsOrZero(dbUp: boolean): Promise<Record<string, number>> {
  if (!dbUp) return { slack: 0, teams: 0 };
  try {
    return await integrationCounts();
  } catch {
    return { slack: 0, teams: 0 };
  }
}

export async function GET() {
  const [dbUp, dirWritable] = await Promise.all([pingDatabase(), dataDirWritable()]);
  const ok = dbUp && dirWritable;

  // Counts only, and only when the database answered. Nothing here identifies a company and
  // nothing here is a webhook address. With nothing configured it reads {"slack":0,"teams":0}.
  //
  // A reporting line must never be able to bring the health check down: if the count query fails
  // for any reason, the endpoint still answers with zeroes and the db/dataDir verdict above — which
  // is what a monitor actually watches.
  const integrations = await integrationCountsOrZero(dbUp);

  return NextResponse.json(
    {
      ok,
      status: ok ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      dataDir: dirWritable ? "writable" : "not writable",
      sentry: sentryStatus(),
      integrations,
      // Reporting only, and only about THIS copy of the app: the sweep is not something the app's
      // correctness depends on (overdue is always derived at read time), so a skipped or failed run
      // never makes the app unhealthy.
      sweep: sweepStatus(),
      uptime: Math.round(process.uptime()),
    },
    { status: ok ? 200 : 503 },
  );
}
