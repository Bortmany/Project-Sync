// The interactive half of Admin → Billing — the ONLY client code on that page.
//
// The page itself stays a server component: it reads the plan, the usage and whether a provider is
// configured, and passes plain booleans down. Nothing in this file ever sees an API key, a customer
// id or a subscription id — it presses a button, the server mints an address, and the browser
// navigates there.
//
// NO THIRD-PARTY JAVASCRIPT IS LOADED ANYWHERE. Both buttons end in an ordinary top-level
// navigation to the provider's own site, which no Content-Security-Policy directive governs, so
// next.config.ts needs nothing added for billing. (The overlay alternative, and the CSP entries it
// would cost, is written up in docs/GO-LIVE.md, section 8.)

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openBillingPortal, startUpgrade } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { Button, ErrorBanner } from "@/components/ui";
import type { BillingRedirectDTO, PlanName } from "@/lib/zod-schemas";

/** How often the page re-checks itself while a payment's confirmation is still on its way. */
const RECHECK_MS = 5_000;

/** After this long we stop re-checking and soften the wording rather than spinning for ever. */
const GIVE_UP_MS = 120_000;

/* ------------------------------------------------------------------ */
/* The buttons                                                         */
/* ------------------------------------------------------------------ */

export function BillingButtons({
  plan,
  hasSubscription,
}: {
  plan: PlanName;
  hasSubscription: boolean;
}) {
  const { run, pending, error } = useAction();

  /** The server hands back one address; going there is a plain navigation, not a fetch. */
  function goTo(data: BillingRedirectDTO) {
    window.location.assign(data.url);
  }

  function upgrade() {
    run(() => startUpgrade(), {
      failure: "We couldn't open checkout. Try again in a moment.",
      onSuccess: goTo,
    });
  }

  function manage() {
    run(() => openBillingPortal(), {
      failure: "We couldn't open your billing page. Try again in a moment.",
      onSuccess: goTo,
    });
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorBanner message={error} /> : null}

      {plan === "PRO" ? (
        hasSubscription ? (
          <Button variant="ghost" loading={pending} onClick={manage}>
            Manage billing
          </Button>
        ) : (
          <p className="text-sm text-[var(--brand-text)]">
            Your company is on Pro. We don&rsquo;t have a subscription on file to manage — if you
            have just paid, give it a minute and refresh this page.
          </p>
        )
      ) : (
        <Button loading={pending} onClick={upgrade}>
          Upgrade to Pro
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Coming back from checkout                                           */
/* ------------------------------------------------------------------ */

/**
 * The strip shown after paying, and the only thing on this page that moves on its own.
 *
 * THE PLAN CAN LAG BEHIND THE REDIRECT. The provider confirms the payment with a webhook, which
 * arrives a moment after the browser does, so the card must never say "you're on Pro" before the
 * database does. While the company still reads FREE, this asks the page to re-render itself every
 * few seconds — the page is already a server read, so refreshing it is the same one source of
 * truth rather than a second one — and after two minutes it stops and says so plainly.
 */
export function BillingReturnStrip({ plan }: { plan: PlanName }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const startedAt = useRef(Date.now());

  const waiting = plan !== "PRO" && !gaveUp;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  if (dismissed) return null;

  const message =
    plan === "PRO"
      ? "Welcome to Pro! Your limits just opened right up."
      : gaveUp
        ? "Still confirming your payment — if this doesn't update soon, Manage billing will show your subscription, or contact us if something looks wrong."
        : "Payment received — we're just waiting for the final confirmation. This page will update on its own, usually within a minute.";

  return (
    <div className="flex max-w-2xl items-start justify-between gap-4 rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2">
      <p className="text-sm text-[var(--brand-ink)]">{message}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
