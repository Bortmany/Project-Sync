// The sign-in form: posts to /api/auth/login and shows one plain-English message when it fails.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { homePathFor } from "@/components/shell/nav-items";
import { Button, Field, Input } from "@/components/ui";
import type { RoleName } from "@/lib/zod-schemas";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: { role?: RoleName };
      };
      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      // A contractor's home is My tasks, not the dashboard — the same page their sidebar leads with.
      router.replace(result.data?.role ? homePathFor(result.data.role) : "/dashboard");
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
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

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
