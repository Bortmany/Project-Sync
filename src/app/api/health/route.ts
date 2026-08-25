// Health check: database reachable, uploads folder writable, whether each error-tracking
// channel (server and browser) is switched on, and how the hourly deadline sweep is getting on.

import { NextResponse } from "next/server";
import { access, constants, mkdir } from "node:fs/promises";
import { pingDatabase } from "@/lib/db";
import { sentryStatus } from "@/lib/error-reporting";
import { uploadsDir } from "@/lib/upload";
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

export async function GET() {
  const [dbUp, dirWritable] = await Promise.all([pingDatabase(), dataDirWritable()]);
  const ok = dbUp && dirWritable;

  return NextResponse.json(
    {
      ok,
      status: ok ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      dataDir: dirWritable ? "writable" : "not writable",
      sentry: sentryStatus(),
      // Reporting only, and only about THIS copy of the app: the sweep is not something the app's
      // correctness depends on (overdue is always derived at read time), so a skipped or failed run
      // never makes the app unhealthy.
      sweep: sweepStatus(),
      uptime: Math.round(process.uptime()),
    },
    { status: ok ? 200 : 503 },
  );
}
