// The sign-in form: posts to /api/auth/login and shows one plain-English message when it fails.
//
// It has two phases in one form, and no second page: an account with two-factor sign-in switched on
// gets back "a second step is needed" and a five-minute ticket instead of a session, and the same
// panel swaps to asking for the six digits. Nothing about the shell around it changes.
//
// The subline under "Sign in" lives here rather than on the page, because it is the one line that
// has to change with the phase.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { homePathFor } from "@/components/shell/nav-items";
import { Button, Field, Input } from "@/components/ui";
import type { RoleName } from "@/lib/zod-schemas";

type LoginAnswer = {
  ok: boolean;
  error?: string;
  data?: {
    role?: RoleName;
    /** Only ever "TWO_FACTOR_REQUIRED" — the password was right and a second step is needed. */
    status?: string;
    pendingToken?: string;
  };
};

const UNREACHABLE = "We could not reach the server. Check your connection and try again.";
const SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Phase 2: the ticket the password step handed back, and what the person is typing into it.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  // A 429 is "wait", not "wrong": it is shown calmly and the button is taken away until they do.
  const [waiting, setWaiting] = useState<string | null>(null);

  function signIn(role: RoleName | undefined): void {
    // A contractor's home is My tasks, not the dashboard — the same page their sidebar leads with.
    router.replace(role ? homePathFor(role) : "/dashboard");
    router.refresh();
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as LoginAnswer;
      if (!result.ok) {
        setError(result.error ?? SOMETHING_WENT_WRONG);
        return;
      }
      if (result.data?.status === "TWO_FACTOR_REQUIRED" && result.data.pendingToken) {
        setPendingToken(result.data.pendingToken);
        setPassword("");
        return;
      }
      signIn(result.data?.role);
    } catch {
      setError(UNREACHABLE);
    } finally {
      setLoading(false);
    }
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingToken,
          ...(usingRecoveryCode ? { recoveryCode: code } : { code }),
        }),
      });
      const result = (await response.json()) as LoginAnswer;
      if (response.status === 429) {
        setWaiting(result.error ?? "Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error ?? SOMETHING_WENT_WRONG);
        return;
      }
      signIn(result.data?.role);
    } catch {
      setError(UNREACHABLE);
    } finally {
      setLoading(false);
    }
  }

  function back() {
    setPendingToken(null);
    setCode("");
    setUsingRecoveryCode(false);
    setError(null);
    setWaiting(null);
  }

  const alert = error ? (
    <p
      role="alert"
      className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
    >
      {error}
    </p>
  ) : null;

  if (pendingToken) {
    return (
      <>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Enter the code from your authenticator app.
        </p>

        <form onSubmit={onCode} className="mt-6 space-y-4" noValidate>
          <p className="text-sm">
            <button
              type="button"
              onClick={back}
              className="text-[var(--brand-primary)] underline-offset-2 hover:underline"
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
                    setError(null);
                  }}
                  className="text-[var(--brand-primary)] underline-offset-2 hover:underline"
                >
                  {usingRecoveryCode
                    ? "Use your authenticator app instead"
                    : "Use a recovery code instead"}
                </button>
              </p>

              <p className="text-xs text-[var(--brand-gray)]">This step expires in 5 minutes.</p>

              {alert}

              <Button type="submit" loading={loading} className="w-full">
                {loading ? "Verifying…" : "Verify and sign in"}
              </Button>
            </>
          )}
        </form>
      </>
    );
  }

  return (
    <>
      <p className="mt-1 text-sm text-[var(--brand-text)]">
        Use your work email. Accounts are set up by your workspace administrator.
      </p>

      <form onSubmit={onPassword} className="mt-6 space-y-4" noValidate>
        <Field label="Email">
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {/* Always here, whether or not this deployment sends email: a signed-out visitor has no way
            of knowing, and the page it leads to is what explains it. Its own row, so the tap target
            on a phone is comfortable rather than crammed against the input. */}
        <p className="text-right text-sm">
          <Link
            href="/forgot-password"
            className="inline-block py-1 text-[var(--brand-primary)] underline-offset-2 hover:underline"
          >
            Forgot password?
          </Link>
        </p>

        {alert}

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </>
  );
}
