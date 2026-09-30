// The sign-in form: posts to /api/auth/login and shows one plain-English message when it fails.
//
// It has two phases in one form, and no second page: an account with two-factor sign-in switched on
// gets back "a second step is needed" and a five-minute ticket instead of a session, and the same
// panel swaps to asking for the six digits. Nothing about the shell around it changes.
//
// The subline under "Sign in" lives here rather than on the page, because it is the one line that
// has to change with the phase.
//
// "Sign in with Microsoft" is the second door, and it only exists when the page hands in the
// `microsoft` prop (the Azure app is registered on this Tielora). Without it this component renders
// exactly what it always did: no divider, no button, no extra wrapper, and it never looks at the
// address bar. With it:
//  - `?microsoft=failed` shows the password route's own refused sentence, under the subline, and the
//    parameter is taken out of the address so a refresh shows the ordinary page;
//  - `#mstf=<ticket>` (Microsoft said yes, and the person has Tielora two-factor on) is read once,
//    removed from the address at once, and swaps straight to the six-digit step. The ticket lives in
//    memory only — never a query string, a log line or a cookie — and a refresh simply loses it.

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { homePathFor } from "@/components/shell/nav-items";
import { Button, Field, Input } from "@/components/ui";
import { SIGN_IN_REFUSED_MESSAGE } from "@/lib/sign-in-messages";
import type { RoleName } from "@/lib/zod-schemas";

/**
 * The address-fragment key the Microsoft callback hands the two-factor ticket over in. Must equal
 * TWO_FACTOR_FRAGMENT_KEY in src/app/api/auth/microsoft/attempt-cookie.ts (a test pins the two);
 * that file reads cookies on the server, so it cannot be imported into this browser component.
 */
export const MICROSOFT_TICKET_FRAGMENT_KEY = "mstf";

/** What a ticket looks like: letters, digits, "-" and "_" only. Anything else is ignored. */
const TICKET_SHAPE = /^[A-Za-z0-9_-]{16,256}$/;

/** Handed in by the page only when "Sign in with Microsoft" is set up on this Tielora. */
type MicrosoftProps = {
  /** The browser came back from a refused Microsoft sign-in (`?microsoft=failed`). */
  refused: boolean;
};

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

/** Takes one thing out of the address bar without a navigation, keeping the router's own state. */
function replaceAddress(url: URL): void {
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The divider, the white "Sign in with Microsoft" link and the grey line under it. A real link, not
 * a fetch: Microsoft's pages need a full navigation, and no Microsoft script is ever loaded here.
 * The four-colour logo is a picture file — its colours live in the SVG, never in a style.
 */
function MicrosoftSignInButton() {
  const [opening, setOpening] = useState(false);

  // Coming back with the browser's Back button restores this page from memory, still "opening".
  useEffect(() => {
    const reset = () => setOpening(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className="mt-6 mb-4 flex items-center gap-3 text-xs text-[var(--brand-text)]"
      >
        <span className="h-px flex-1 bg-[var(--border)]" />
        or
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <a
        href="/api/auth/microsoft"
        title="Sign in with your Microsoft work account"
        aria-busy={opening ? "true" : undefined}
        onClick={() => setOpening(true)}
        className={`flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--brand-gray)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--brand-text)] transition-colors hover:bg-[var(--page-bg)] active:bg-[var(--border)] ${
          opening ? "pointer-events-none" : ""
        }`}
      >
        <Image
          src="/brand/microsoft-logo.svg"
          width={21}
          height={21}
          alt=""
          aria-hidden="true"
          unoptimized
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 break-words text-center">
          {opening ? "Opening Microsoft…" : "Sign in with Microsoft"}
        </span>
      </a>
      <p className="mt-2 break-words text-xs text-[var(--brand-text)]">
        Works once your company&rsquo;s administrator has switched it on.
      </p>
    </>
  );
}

export function LoginForm({ microsoft }: { microsoft?: MicrosoftProps } = {}) {
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

  // Microsoft only — all three stay at their resting values when the prop is absent.
  const [microsoftRefused, setMicrosoftRefused] = useState(microsoft?.refused ?? false);
  const [viaMicrosoft, setViaMicrosoft] = useState(false);
  // Until the first browser render has looked for a ticket, the panel is held invisible so somebody
  // arriving at `/login#mstf=…` never sees the password form flash first. Set up deployments only.
  const [checkedAddress, setCheckedAddress] = useState(microsoft === undefined);
  const microsoftAvailable = microsoft !== undefined;

  useEffect(() => {
    if (!microsoftAvailable) return;
    const url = new URL(window.location.href);

    const fragment = new URLSearchParams(url.hash.slice(1));
    const ticket = fragment.get(MICROSOFT_TICKET_FRAGMENT_KEY);
    if (ticket !== null) {
      // Out of the address at once, whatever it looks like, so it cannot linger in the history.
      url.hash = "";
      replaceAddress(url);
      if (TICKET_SHAPE.test(ticket)) {
        setPendingToken(ticket);
        setViaMicrosoft(true);
      }
    } else if (url.searchParams.has("microsoft")) {
      url.searchParams.delete("microsoft");
      replaceAddress(url);
    }

    setCheckedAddress(true);
  }, [microsoftAvailable]);

  function signIn(role: RoleName | undefined): void {
    // A contractor's home is My tasks, not the dashboard — the same page their sidebar leads with.
    router.replace(role ? homePathFor(role) : "/dashboard");
    router.refresh();
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMicrosoftRefused(false);
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
    setViaMicrosoft(false);
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

  // Set-up deployments only: held invisible until the address has been checked for a ticket.
  const held = (content: ReactNode) =>
    microsoftAvailable ? (
      <div className={checkedAddress ? undefined : "invisible"}>{content}</div>
    ) : (
      content
    );

  if (pendingToken) {
    return held(
      <>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          {viaMicrosoft
            ? "Microsoft accepted your sign-in. Enter the code from your authenticator app to finish."
            : "Enter the code from your authenticator app."}
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

  return held(
    <>
      <p className="mt-1 text-sm text-[var(--brand-text)]">
        Use your work email. Accounts are set up by your workspace administrator.
      </p>

      <form onSubmit={onPassword} className="mt-6 space-y-4" noValidate>
        {/* A refused Microsoft sign-in: the same strip and the same words as a wrong password, but
            up here, because the person has just arrived and a phone would hide it further down. */}
        {microsoftRefused ? (
          <p
            role="alert"
            className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
          >
            {SIGN_IN_REFUSED_MESSAGE}
          </p>
        ) : null}

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
      {microsoftAvailable ? <MicrosoftSignInButton /> : null}
    </>
  );
}
