// Where Microsoft sends the administrator back to. This is the address registered in Azure
// (MS_GRAPH_REDIRECT_PATH, default /api/integrations/microsoft/callback).
//
// It exchanges the one-time code for tokens, stores them encrypted, and sends the person back to
// Admin → Integrations with a word saying how it went. The code and the tokens never appear in a
// redirect, a log line or an error message.

import { NextResponse } from "next/server";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { byUser, limit } from "@/lib/rate-limit";
import { fail } from "@/server/http";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";
import { completeMicrosoftConnect, microsoftAvailable } from "@/server/services/microsoft";

export const dynamic = "force-dynamic";

const CALLBACK_LIMIT = 10;
const CALLBACK_WINDOW_MS = 60_000;

function back(request: Request, outcome: string): NextResponse {
  return NextResponse.redirect(new URL(`/admin/integrations?microsoft=${outcome}`, request.url), 302);
}

export async function GET(request: Request) {
  if (!microsoftAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const actor = await currentActor();
  if (!actor) return fail(SIGNED_OUT_MESSAGE, 401);

  const throttle = limit(byUser(actor.userId, "microsoft-callback"), CALLBACK_LIMIT, CALLBACK_WINDOW_MS);
  if (!throttle.ok) return back(request, "failed");

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  // Microsoft says no by sending an error back instead of a code — usually somebody pressed Cancel.
  if (params.get("error")) return back(request, "denied");
  if (!code || !state) return back(request, "failed");

  try {
    await completeMicrosoftConnect(actor, { code, state });
    return back(request, "connected");
  } catch {
    // Everything that can go wrong here (a stale state, a refused code, a missing permission) is
    // explained on the card itself; nothing from Microsoft's answer is echoed into the address bar.
    return back(request, "failed");
  }
}
