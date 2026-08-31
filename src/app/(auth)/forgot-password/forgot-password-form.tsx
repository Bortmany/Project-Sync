// Asking for a reset link. One field, one button, and one confirmation that appears no matter what
// the address was — registered, unregistered or mistyped. That is the whole point of the screen:
// somebody typing other people's addresses into it learns nothing about any of them.

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? "We could not send that link. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-ink)]">Check your email</h3>
        <p className="text-sm text-[var(--brand-text)]">
          If that address has a Tielora account, we&apos;ve sent a link to reset your password. It
          will expire in an hour — if it doesn&apos;t arrive in a few minutes, check spam, or try
          again.
        </p>
        <p className="text-sm text-[var(--brand-text)]">
          <Link
            href="/login"
            className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
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

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="w-full">
        {loading ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-[var(--brand-text)]">
        <Link
          href="/login"
          className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
