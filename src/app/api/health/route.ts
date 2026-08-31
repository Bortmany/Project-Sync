// Health check: database reachable, uploads folder writable, whether each error-tracking
// channel (server and browser) is switched on, how the hourly deadline sweep is getting on, and
// how many companies have each chat integration switched on, whether transactional email is
// keyed up or dormant, and whether payments are set up on this deployment.

import { NextResponse } from "next/server";
import { access, constants, mkdir } from "node:fs/promises";
import { pingDatabase } from "@/lib/db";
import { sentryStatus } from "@/lib/error-reporting";
import { isMicrosoftConfigured } from "@/lib/ms-graph";
import { uploadsDir } from "@/lib/upload";
import { billingHealth } from "@/server/services/billing";
import { emailStatus } from "@/server/services/email";
import { integrationCounts } from "@/server/services/integrations";
import { microsoftHealth } from "@/server/services/microsoft";
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

  // Microsoft 365 file attachments: "dormant" until the Azure app is registered, then "configured"
  // with how many companies have connected. A number and a word — nothing that names anybody.
  const microsoft = dbUp
    ? await microsoftHealth()
    : { status: isMicrosoftConfigured() ? "configured" : "dormant", connectedOrgs: 0 };

  return NextResponse.json(
    {
      ok,
      status: ok ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      dataDir: dirWritable ? "writable" : "not writable",
      sentry: sentryStatus(),
      integrations,
      microsoft,
      // Transactional email: "dormant" until RESEND_API_KEY, EMAIL_FROM and APP_BASE_URL are all
      // set, then "configured". A word, and nothing else — no address, no count of anybody.
      email: emailStatus(),
      // Payments: "dormant" until all four provider variables are set, then "configured". A word
      // about configuration and nothing else — never a plan count, never a balance, never money.
      billing: billingHealth(),
      // Reporting only, and only about THIS copy of the app: the sweep is not something the app's
      // correctness depends on (overdue is always derived at read time), so a skipped or failed run
      // never makes the app unhealthy.
      sweep: sweepStatus(),
      uptime: Math.round(process.uptime()),
    },
    { status: ok ? 200 : 503 },
  );
}
