// The one form behind both /reset-password and /set-password. Same fields, same 12-character rule,
// same round trip — only the wording and the route change with the mode.
//
// The checks here mirror the server's word for word (PasswordSchema in src/lib/zod-schemas.ts).
// They only save a round trip; the server is the authority, and its answer always wins.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";

export type PasswordMode = "reset" | "invite";

const COPY = {
  reset: {
    route: "/api/auth/reset-password",
    submit: "Reset password",
    submitting: "Resetting…",
    /** What the login page shows once they land there. */
    done: "password",
  },
  invite: {
    route: "/api/auth/set-password",
    submit: "Set password",
    submitting: "Setting…",
    done: "invite",
  },
} as const;

/** The same wording the signup form uses, so the rule reads the same everywhere. */
const TOO_SHORT = "Use at least 12 characters — a short sentence works well.";
const NO_MATCH = "Passwords don't match.";

export function ChoosePasswordForm({ mode, token }: { mode: PasswordMode; token: string }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const short = password.length < 12 ? TOO_SHORT : undefined;
    const mismatch = confirm !== password ? NO_MATCH : undefined;
    setPasswordError(short);
    setConfirmError(mismatch);
    if (short || mismatch) return;

    setLoading(true);
    try {
      const response = await fetch(copy.route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        fieldErrors?: Record<string, string[]>;
      };

      if (!result.ok) {
        setPasswordError(result.fieldErrors?.password?.[0]);
        setError(result.error ?? "We could not change your password. Please try again.");
        return;
      }

      // Straight to sign in. Setting a password is not signing in: nothing here creates a session,
      // so the new password gets used once, deliberately, on the page they land on.
      router.replace(`/login?done=${copy.done}`);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field
        label="New password"
        hint="At least 12 characters. A short sentence works well."
        error={passwordError}
      >
        <Input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Field label="Confirm password" error={confirmError}>
        <Input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="w-full">
        {loading ? copy.submitting : copy.submit}
      </Button>

      {error && mode === "reset" ? (
        <p className="text-center text-sm text-[var(--brand-text)]">
          <Link
            href="/forgot-password"
            className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
          >
            Send a new link
          </Link>
        </p>
      ) : null}
    </form>
  );
}
