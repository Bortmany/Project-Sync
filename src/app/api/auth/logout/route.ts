// Sign out: deletes the session row and clears the cookie.

import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true, data: { signedOut: true } });
}
