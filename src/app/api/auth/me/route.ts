// Who am I: the signed-in person, or a 401 when the session has gone.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "You are signed out." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, data: user });
}
