// The one button on /unsubscribe. A real form that POSTs to /api/email/unsubscribe, so it works with
// scripts blocked (the route then brings the browser back to this page with the same sentence);
// with scripts on, the press is sent in the background and the sentence appears in place.
//
// Nothing here knows whether the link was genuine, and nothing it shows could say so: the words
// after the press are the same for every token.

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { UNSUBSCRIBE_BUSY_MESSAGE, UNSUBSCRIBE_DONE_MESSAGE } from "@/lib/email-text";
import { GoodNews } from "../auth-split";

const LINK_CLASS =
  "inline-flex min-h-11 items-center font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline";

type Phase = "ready" | "working" | "done" | "busy" | "offline";

export function UnsubscribeForm({
  action,
  initiallyDone,
  initiallyBusy,
}: {
  /** `/api/email/unsubscribe?t=…` — or without the token, when the page was opened without one. */
  action: string;
  initiallyDone: boolean;
  initiallyBusy: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(
    initiallyDone ? "done" : initiallyBusy ? "busy" : "ready",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "working") return;
    setPhase("working");
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ confirm: "yes" }).toString(),
        // The route answers a form press by sending the browser back to this page. In the
        // background that redirect IS the success, so it is not followed.
        redirect: "manual",
      });
      if (response.status === 429) {
        setPhase("busy");
        return;
      }
      setPhase(response.type === "opaqueredirect" || response.ok ? "done" : "offline");
    } catch {
      setPhase("offline");
    }
  }

  if (phase === "done") {
    return (
      <div className="mt-6">
        <div role="status">
          <GoodNews>{UNSUBSCRIBE_DONE_MESSAGE}</GoodNews>
        </div>
        <p className="text-sm">
          <Link href="/account" className={LINK_CLASS}>
            Go to Your account
          </Link>
        </p>
        <p className="text-sm">
          <Link href="/login" className={LINK_CLASS}>
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form method="post" action={action} onSubmit={onSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="confirm" value="yes" />

      {phase === "busy" ? (
        <p
          role="status"
          className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-ink)]"
        >
          {UNSUBSCRIBE_BUSY_MESSAGE}
        </p>
      ) : null}
      {phase === "offline" ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
        >
          We could not reach the server. Check your connection and try again.
        </p>
      ) : null}

      <Button
        type="submit"
        loading={phase === "working"}
        aria-busy={phase === "working"}
        className="min-h-11 w-full"
      >
        {phase === "working" ? "Working…" : "Unsubscribe"}
      </Button>

      <p className="text-sm">
        <Link href="/login" className={LINK_CLASS}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
