// One-click unsubscribe (RFC 8058) — what Outlook's and Gmail's own "Unsubscribe" button sends, and
// what the button on /unsubscribe posts. Public: no sign-in, the signed token is the whole key.
//
// Three rules govern this route:
//  1. **A GET never unsubscribes anybody.** Mail scanners (Outlook Safe Links, Gmail's fetcher)
//     open every link in a message before the person does, so a GET only sends the visitor on to
//     the confirmation page (303). Only a POST acts.
//  2. **The answer is the same whatever the token.** Genuine, tampered with, from an older format,
//     for a deactivated account, or missing: the same status and the same bytes, after the same
//     work (the token check and the lookup behind it cost the same on a hit and a miss).
//  3. **Generous on purpose.** Gmail and Outlook send one-click requests for many people from a few
//     shared addresses, and a refused one leaves somebody subscribed, so the ceiling is 300 a minute
//     per address — high enough for that, still a ceiling.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  UNSUBSCRIBE_BUSY_MESSAGE,
  UNSUBSCRIBE_DONE_MESSAGE,
  UNSUBSCRIBE_LIMIT,
} from "@/lib/email-text";
import { byIp, limit } from "@/lib/rate-limit";
import { unsubscribeWithToken } from "@/server/services/email-preferences";
import { appBaseUrl } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

/** Requests per IP address per minute. */
const UNSUBSCRIBE_WINDOW_MS = 60_000;

/** A token is short; anything longer is not one, and is treated exactly like any other miss. */
const MAX_TOKEN_CHARS = 200;

/** The largest body worth reading. The one-click body is 26 bytes; the page's form is smaller. */
const MAX_BODY_BYTES = 2_048;

const PLAIN_TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function tokenFrom(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("t");
  return raw && raw.length <= MAX_TOKEN_CHARS ? raw : null;
}

/** Is this the RFC 8058 body a mail client sends, rather than the page's own form? */
async function isOneClick(request: Request): Promise<boolean> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return false;
  try {
    const text = (await request.text()).slice(0, MAX_BODY_BYTES);
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) return /List-Unsubscribe[\s\S]*One-Click/.test(text);
    return new URLSearchParams(text).get("List-Unsubscribe") === "One-Click";
  } catch {
    return false;
  }
}

/** The one answer: turns off that kind of email for that person, then says the same thing to all. */
export async function POST(request: Request) {
  const throttle = limit(byIp(request, "email-unsubscribe"), UNSUBSCRIBE_LIMIT, UNSUBSCRIBE_WINDOW_MS);
  if (!throttle.ok) {
    return new NextResponse(UNSUBSCRIBE_BUSY_MESSAGE, {
      status: 429,
      headers: { ...PLAIN_TEXT, "Retry-After": String(throttle.retryAfterSec) },
    });
  }

  const oneClick = await isOneClick(request);

  try {
    await unsubscribeWithToken(tokenFrom(request));
  } catch (error) {
    // A category and nothing else — never the token, never a person's id from it.
    logger.error("Could not carry out an unsubscribe link", {
      reason: error instanceof Error ? error.name : "unknown",
    });
  }

  // A mail client wants a plain 200. The page's own form (sent without scripts) is taken back to
  // the page, which shows the same sentence — the token deliberately left out of the address.
  if (oneClick) return new NextResponse(UNSUBSCRIBE_DONE_MESSAGE, { status: 200, headers: PLAIN_TEXT });
  return NextResponse.redirect(new URL("/unsubscribe?done=1", siteBase(request)), 303);
}

/** This deployment's own address (behind a proxy the request's may be an internal one). */
function siteBase(request: Request): string {
  return appBaseUrl() ?? request.url;
}

/** A mail scanner opening the link. Changes nothing; sends a person on to the page with the button. */
export async function GET(request: Request) {
  const token = tokenFrom(request);
  const target = new URL("/unsubscribe", siteBase(request));
  if (token) target.searchParams.set("t", token);
  return NextResponse.redirect(target, 303);
}
