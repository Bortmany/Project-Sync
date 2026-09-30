// "Stop these emails?" — where the link at the bottom of an alert or brief email lands.
//
// Opening this page changes NOTHING: mail scanners open every link in a message, so only the
// button (a POST) unsubscribes anybody. And the page is identical for a genuine token, a tampered
// one, an old one and none at all — same words, same layout, same length. It never looks the token
// up, never names a person, a company, an address or which kind of email it was.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { UNSUBSCRIBE_LIMIT } from "@/lib/email-text";
import { byIp, limit } from "@/lib/rate-limit";
import { AuthLegalLinks, AuthSplit } from "../auth-split";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = {
  title: "Unsubscribe — Tielora",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/** A token is short; anything longer is not one, and is simply left off the button's address. */
const MAX_TOKEN_CHARS = 200;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; done?: string | string[] }>;
}) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);

  // The same key shape every anonymous page uses, built from the incoming headers because a page
  // is handed no Request of its own.
  const key = byIp(
    new Request("https://tielora.local/unsubscribe", { headers: requestHeaders }),
    "unsubscribe-page",
  );
  const throttle = limit(key, UNSUBSCRIBE_LIMIT, 60_000);

  const token = typeof params.t === "string" && params.t.length <= MAX_TOKEN_CHARS ? params.t : "";
  const action = token
    ? `/api/email/unsubscribe?t=${encodeURIComponent(token)}`
    : "/api/email/unsubscribe";

  return (
    <AuthSplit>
      <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Stop these emails?</h2>
      <p className="mt-1 text-sm text-[var(--brand-text)]">Press the button to confirm.</p>
      <UnsubscribeForm
        action={action}
        initiallyDone={params.done === "1"}
        initiallyBusy={!throttle.ok}
      />
      <AuthLegalLinks />
    </AuthSplit>
  );
}
