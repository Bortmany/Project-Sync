// Health check: database reachable, uploads folder writable, and whether error tracking is switched on.

import { NextResponse } from "next/server";
import { access, constants, mkdir } from "node:fs/promises";
import { pingDatabase } from "@/lib/db";
import { uploadsDir } from "@/lib/upload";

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
      sentry: process.env.SENTRY_DSN ? "configured" : "dormant",
      uptime: Math.round(process.uptime()),
    },
    { status: ok ? 200 : 503 },
  );
}
