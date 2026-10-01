// The tab while nobody is signed in to it. Five states, never a blank screen:
//  - checking: the silent single sign-on Teams offers is tried first ("Signing you in…").
//  - ready: one card, "Sign in to see your day", one button that opens Microsoft's small window.
//  - two-factor: Microsoft was accepted; the person's own six digits (or a recovery code) are asked.
//  - blocked: the browser or Teams keeps no sign-in for this frame (or this page is not in Teams at
//    all) — "Open Tielora in your browser instead", with a button.
// Every failure is the same sentence, so nobody learns which reason it was.
//
// After a good sign-in the page simply reloads (`/teams/tab?tried=1`): the server reads the tab's
// own cookie and draws the day. If it still finds no cookie, `tried` turns this into the blocked
// state instead of a loop.

"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { loadTeams, openInBrowser } from "@/components/teams/teams-host";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { SkeletonRows } from "@/components/ui/skeleton";
import { TEAMS_SIGN_IN_FAILED_MESSAGE } from "@/lib/teams-messages";

type Phase = "checking" | "ready" | "popup" | "two-factor" | "blocked";

type Answer = {
  ok: boolean;
  error?: string;
  data?: { status?: string; pendingToken?: string };
};

const SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";

function alertStrip(message: string) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
    >
      {message}
    </p>
  );
}

export function TeamsSignIn({ cookiesBlocked }: { cookiesBlocked: boolean }) {
  const [phase, setPhase] = useState<Phase>(cookiesBlocked ? "blocked" : "checking");
  const [failure, setFailure] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const signedIn = useCallback(() => {
    // The tab's own cookie is set; the server draws the day from it.
    window.location.replace("/teams/tab?tried=1");
  }, []);

  /** Handles what /api/teams/session answered. Returns true when the person is now signed in. */
  const takeAnswer = useCallback(
    (status: number, answer: Answer): boolean => {
      if (status === 429) {
        setWaiting(answer.error ?? "Too many attempts. Please wait a few minutes and try again.");
        setPhase("ready");
        return false;
      }
      if (answer.ok && answer.data?.status === "SIGNED_IN") {
        signedIn();
        return true;
      }
      if (answer.ok && answer.data?.status === "TWO_FACTOR_REQUIRED" && answer.data.pendingToken) {
        setPendingToken(answer.data.pendingToken);
        setPhase("two-factor");
        return true;
      }
      return false;
    },
    [signedIn],
  );

  const postSession = useCallback(
    async (body: { ssoToken: string } | { handoffCode: string }): Promise<boolean> => {
      try {
        const response = await fetch("/api/teams/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        });
        return takeAnswer(response.status, (await response.json()) as Answer);
      } catch {
        return false;
      }
    },
    [takeAnswer],
  );

  // Silent single sign-on first. Anything that does not work quietly leaves the button standing.
  useEffect(() => {
    if (cookiesBlocked) return;
    let cancelled = false;
    void (async () => {
      const teams = await loadTeams();
      if (cancelled) return;
      if (!teams) {
        // Not inside Teams (or Teams never answered): there is nothing to sign in to here.
        setPhase("blocked");
        return;
      }
      try {
        const token = await teams.authentication.getAuthToken();
        if (cancelled) return;
        if (await postSession({ ssoToken: token })) return;
      } catch {
        // No token (consent needed, or the admin has not approved yet): fall through to the button.
      }
      if (!cancelled) setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [cookiesBlocked, postSession]);

  // Focus goes to the heading whenever a new state appears.
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  async function signInWithMicrosoft() {
    setFailure(null);
    setWaiting(null);
    setPhase("popup");
    try {
      const teams = await loadTeams();
      if (!teams) {
        setPhase("blocked");
        return;
      }
      const handoffCode = await teams.authentication.authenticate({
        url: `${window.location.origin}/api/auth/microsoft?via=teams`,
        width: 600,
        height: 600,
      });
      if (!(await postSession({ handoffCode }))) {
        setPhase((current) => (current === "two-factor" ? current : "ready"));
        setFailure((current) => current ?? TEAMS_SIGN_IN_FAILED_MESSAGE);
      }
    } catch (error) {
      // Closing the window is not an error; anything else is the one generic sentence.
      setPhase("ready");
      if (!String(error).includes("CancelledByUser")) setFailure(TEAMS_SIGN_IN_FAILED_MESSAGE);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      const response = await fetch("/api/teams/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          pendingToken,
          ...(usingRecoveryCode ? { recoveryCode: code } : { code }),
        }),
      });
      const answer = (await response.json()) as Answer;
      if (response.status === 429) {
        setWaiting(answer.error ?? "Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (!answer.ok) {
        setFailure(answer.error ?? SOMETHING_WENT_WRONG);
        return;
      }
      signedIn();
    } catch {
      setFailure(SOMETHING_WENT_WRONG);
    } finally {
      setBusy(false);
    }
  }

  function back() {
    setPendingToken(null);
    setCode("");
    setUsingRecoveryCode(false);
    setFailure(null);
    setWaiting(null);
    setPhase("ready");
  }

  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-[var(--brand-ink)] outline-none">
      {text}
    </h2>
  );

  if (phase === "checking") {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Your day</h1>
        <p className="mb-4 mt-2 text-sm text-[var(--brand-text)]" role="status">
          Signing you in…
        </p>
        <SkeletonRows rows={6} />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-[12vh] w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-white p-6">
      <h1 className="sr-only">Your day</h1>
      <div aria-live="polite" className="space-y-4">
        {phase === "blocked" ? (
          <>
            {heading("Open Tielora in your browser")}
            <p className="text-sm text-[var(--brand-text)]">
              Your browser is blocking Tielora inside Teams. Open Tielora in your browser instead.
            </p>
            <Button
              type="button"
              className="min-h-11 w-full"
              title="Opens Tielora in your browser"
              onClick={() => void openInBrowser("/login")}
            >
              Open Tielora
            </Button>
          </>
        ) : null}

        {phase === "ready" || phase === "popup" ? (
          <>
            {heading("Sign in to see your day")}
            <p className="text-sm text-[var(--brand-text)]">Use your work Microsoft account.</p>
            {waiting ? (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]"
              >
                {waiting}
              </p>
            ) : null}
            <button
              type="button"
              disabled={phase === "popup"}
              aria-busy={phase === "popup" ? "true" : undefined}
              title="Sign in with your Microsoft work account"
              onClick={() => void signInWithMicrosoft()}
              className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--brand-gray)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--brand-text)] transition-colors hover:bg-[var(--page-bg)] active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {phase === "popup" ? (
                <Spinner size={18} />
              ) : (
                <Image
                  src="/brand/microsoft-logo.svg"
                  width={21}
                  height={21}
                  alt=""
                  aria-hidden="true"
                  unoptimized
                  className="shrink-0"
                />
              )}
              <span className="min-w-0 flex-1 break-words text-center">
                {phase === "popup" ? "Waiting for Microsoft…" : "Sign in with Microsoft"}
              </span>
            </button>
            {phase === "popup" ? (
              <p className="text-xs text-[var(--brand-gray)]">Finish signing in in the Microsoft window.</p>
            ) : null}
            {failure ? alertStrip(failure) : null}
          </>
        ) : null}

        {phase === "two-factor" ? (
          <form onSubmit={submitCode} className="space-y-4" noValidate>
            {heading("Enter your code")}
            <p className="text-sm text-[var(--brand-text)]">
              Microsoft accepted your sign-in. Enter the code from your authenticator app to finish.
            </p>
            <p className="text-sm">
              <button
                type="button"
                onClick={back}
                className="min-h-11 text-[var(--brand-primary)] underline-offset-2 hover:underline"
              >
                ← Back
              </button>
            </p>
            {waiting ? (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]"
              >
                {waiting}
              </p>
            ) : (
              <>
                {usingRecoveryCode ? (
                  <Field label="Recovery code">
                    <Input
                      name="recoveryCode"
                      autoComplete="off"
                      required
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="AB3F-9K2L-MN"
                      className="font-mono"
                    />
                  </Field>
                ) : (
                  <Field label="Verification code">
                    <Input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="123456"
                      className="text-center font-mono text-lg tracking-widest"
                    />
                  </Field>
                )}
                <p className="text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setUsingRecoveryCode((using) => !using);
                      setCode("");
                      setFailure(null);
                    }}
                    className="min-h-11 text-[var(--brand-primary)] underline-offset-2 hover:underline"
                  >
                    {usingRecoveryCode ? "Use your authenticator app instead" : "Use a recovery code instead"}
                  </button>
                </p>
                <p className="text-xs text-[var(--brand-gray)]">This step expires in 5 minutes.</p>
                {failure ? alertStrip(failure) : null}
                <Button type="submit" loading={busy} className="min-h-11 w-full">
                  {busy ? "Verifying…" : "Verify and sign in"}
                </Button>
              </>
            )}
          </form>
        ) : null}
      </div>
    </div>
  );
}
