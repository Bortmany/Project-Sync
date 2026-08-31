// The "verify your email" strip that sits above the topbar until it is dismissed.
//
// It is a nudge and nothing more: nothing in Tielora is withheld from somebody who has not
// verified, so the wording is soft and the dismiss is one press. The server decides whether this
// component is rendered at all — it is only mounted when the deployment can send email AND the
// signed-in person has no verified address — so there is nothing here that hints at a setting.
//
// Dismissing is deliberately throwaway: a flag in sessionStorage, gone at the next full sign-in.
// Nothing is written to the database for it. An unverified address is not urgent enough to earn a
// stored preference the way a dismissed announcement is.

"use client";

import { useEffect, useState } from "react";
import { resendVerificationEmail } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";

const DISMISS_KEY = "tielora.verify-banner.dismissed";

export function VerificationBanner({ email }: { email: string }) {
  // "unknown" until the browser has been asked whether this was already dismissed, so somebody who
  // hid it never sees it flash back on every page they open.
  const [visible, setVisible] = useState<"unknown" | "yes" | "no">("unknown");
  const [sent, setSent] = useState(false);
  const { run, pending } = useAction();

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // Private browsing with storage switched off: show the banner, which is the safe direction.
    }
    setVisible(dismissed ? "no" : "yes");
  }, []);

  if (visible !== "yes") return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Nothing to do — hiding it for this page is still better than ignoring the press.
    }
    setVisible("no");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-4 py-2 text-sm text-[var(--brand-ink)] sm:px-6">
      {sent ? (
        <p className="min-w-0">We&apos;ve sent a new link to {email}. Check your inbox.</p>
      ) : (
        <p className="min-w-0">Verify your email to keep full access to Tielora.</p>
      )}
      <div className="ml-auto flex items-center gap-1">
        {sent ? null : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => resendVerificationEmail(), {
                failure: "Couldn't send that email. Try again shortly.",
                onSuccess: () => setSent(true),
              })
            }
            className="px-2 py-1 font-semibold text-[var(--brand-primary)] hover:underline disabled:text-[var(--brand-gray)]"
          >
            {pending ? "Sending…" : "Resend verification email"}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="rounded p-1 text-[var(--brand-ink)] hover:bg-[var(--page-bg)]"
        >
          {/* A generous tap area around a small mark, the same shape the modal's close button uses. */}
          <span className="flex h-8 w-8 items-center justify-center text-base leading-none">
            &times;
          </span>
        </button>
      </div>
    </div>
  );
}
