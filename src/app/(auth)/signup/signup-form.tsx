// Creating a workspace, in two steps: the company and its first administrator, then the discipline
// template it starts from. One POST to /api/auth/signup at the end — the server is the authority on
// every rule here; the checks in this file only save a round trip, and they use the same wording.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { IndustryTemplateName } from "@/lib/zod-schemas";

export type TemplateOption = {
  value: IndustryTemplateName;
  label: string;
  hint: string;
  /** The discipline names this template seeds, read from src/server/industry-templates.ts. */
  disciplines: string[];
};

type Fields = Record<string, string[]>;

/** The longest each field may be, straight from SignupInput in src/lib/zod-schemas.ts. */
const MAX = { organizationName: 120, name: 200, email: 200, password: 200 } as const;

/**
 * Mirrors SignupInput in src/lib/zod-schemas.ts, message for message — including its maximum
 * lengths, so zod's own "Too big: expected string…" wording never reaches the screen. The inputs
 * carry the same caps as `maxLength`, so hitting one takes typing past the limit in a paste.
 */
function checkStepOne(values: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}): Fields {
  const errors: Fields = {};
  if (values.organizationName.trim().length < 2) {
    errors.organizationName = ["Tell us your company's name."];
  } else if (values.organizationName.trim().length > MAX.organizationName) {
    errors.organizationName = [`Company name is too long — ${MAX.organizationName} characters at most.`];
  }

  if (values.name.trim().length < 1) {
    errors.name = ["Tell us your name."];
  } else if (values.name.trim().length > MAX.name) {
    errors.name = [`Your name is too long — ${MAX.name} characters at most.`];
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = ["Use an email address like name@company.com."];
  } else if (values.email.trim().length > MAX.email) {
    errors.email = [`That email address is too long — ${MAX.email} characters at most.`];
  }

  if (values.password.length < 12) {
    errors.password = ["Use at least 12 characters — a short sentence works well."];
  } else if (values.password.length > MAX.password) {
    errors.password = [`That password is too long — ${MAX.password} characters at most.`];
  }

  return errors;
}

export function SignupForm({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [template, setTemplate] = useState<IndustryTemplateName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Fields>({});
  const [loading, setLoading] = useState(false);

  const first = (key: string): string | undefined => fieldErrors[key]?.[0];

  function onContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const found = checkStepOne({ organizationName, name, email, password });
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    setStep(2);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template) return;
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          name: name.trim(),
          email: email.trim(),
          password,
          industryTemplate: template,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        fieldErrors?: Fields;
      };

      if (!result.ok) {
        setError(result.error ?? "We could not create the workspace. Please try again.");
        const returned = result.fieldErrors ?? {};
        setFieldErrors(returned);
        // Everything the server can name a field for sits on step 1 — a taken email address, a
        // company name that just went. Go back so the person can see which line to fix.
        if (Object.keys(returned).length > 0) setStep(1);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const banner = error ? (
    <p
      role="alert"
      className="rounded-[var(--radius)] border border-[var(--status-blocked)]/40 bg-[var(--status-blocked)]/10 px-3 py-2 text-sm text-[var(--status-blocked)]"
    >
      {error}
    </p>
  ) : null;

  if (step === 2) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-gray)]">
          Step 2 of 2
        </p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--brand-ink)]">Pick a discipline set</h2>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Your projects start with these disciplines. You can change disciplines any time.
        </p>

        <form onSubmit={onCreate} className="mt-6 space-y-4" noValidate>
          <fieldset className="space-y-3">
            <legend className="sr-only">Discipline template</legend>
            {templates.map((option) => {
              const selected = template === option.value;
              return (
                <label
                  key={option.value}
                  className={`block cursor-pointer rounded-[var(--radius)] border bg-white p-4 ${
                    selected
                      ? "border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]"
                      : "border-[var(--border)] hover:border-[var(--brand-gray)]"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="industryTemplate"
                      value={option.value}
                      checked={selected}
                      onChange={() => setTemplate(option.value)}
                      className="mt-1 accent-[var(--brand-primary)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--brand-ink)]">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--brand-gray)]">
                        {option.hint}
                      </span>
                      <span className="mt-2 block text-xs text-[var(--brand-text)]">
                        {option.disciplines.join(" · ")}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {banner}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={loading} disabled={!template} className="flex-1">
              {loading ? "Creating workspace…" : "Create workspace"}
            </Button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-[var(--brand-text)] underline-offset-2 hover:underline"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-gray)]">
        Step 1 of 2
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--brand-ink)]">Create your workspace</h2>
      <p className="mt-1 text-sm text-[var(--brand-text)]">
        Your company gets its own workspace. You run it as its administrator and add everyone else
        afterwards.
      </p>

      <form onSubmit={onContinue} className="mt-6 space-y-4" noValidate>
        <Field label="Company name" error={first("organizationName")}>
          <Input
            name="organizationName"
            autoComplete="organization"
            required
            maxLength={MAX.organizationName}
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            placeholder="Meridian Energy"
          />
        </Field>

        <Field label="Your name" error={first("name")}>
          <Input
            name="name"
            autoComplete="name"
            required
            maxLength={MAX.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Work email" error={first("email")}>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            maxLength={MAX.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
          />
        </Field>

        <Field
          label="Password"
          error={first("password")}
          hint="At least 12 characters. A short sentence works well."
        >
          <Input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            maxLength={MAX.password}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {banner}

        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </div>
  );
}
