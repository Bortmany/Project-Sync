// Admin → "Who can post to Everyone": the one company-wide setting behind the noticeboard.
//
// It lives beside the chat integrations because it is the same kind of thing — a company-level
// preference an administrator sets once — and it saves the moment it changes, with a toast and no
// confirmation dialog, exactly as the integration switches do.

"use client";

import { useState } from "react";
import { setBroadcastPolicy } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { Card, ErrorBanner, Field, Select } from "@/components/ui";
import type { BroadcastPolicyName } from "@/lib/zod-schemas";

const POLICY_OPTIONS: { value: BroadcastPolicyName; label: string }[] = [
  { value: "ADMIN_ONLY", label: "Admins only" },
  { value: "ADMIN_PM", label: "Admins and project managers" },
  { value: "ADMIN_PM_LEAD", label: "Admins, project managers and department leads" },
];

export function AdminBroadcastCard({ policy }: { policy: BroadcastPolicyName }) {
  const { run, pending, error } = useAction();
  const [saved, setSaved] = useState<BroadcastPolicyName>(policy);
  const [draft, setDraft] = useState<BroadcastPolicyName>(policy);

  // While the save is in flight the screen shows what was chosen; if it fails, it falls back to
  // what the company actually has, so a setting is never shown that was not really saved.
  const shown = error ? saved : draft;

  function change(next: BroadcastPolicyName) {
    setDraft(next);
    run(() => setBroadcastPolicy({ policy: next }), {
      success: "Setting saved.",
      failure: "Couldn't save that. Try again.",
      onSuccess: () => setSaved(next),
    });
  }

  return (
    <Card title="Announcements and the team board">
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}

        <Field
          label="Who can post to Everyone"
          hint="Everyone in the company can always READ posts to Everyone. This controls who can start one. Project and department boards are unaffected: a project manager always posts to their own projects, a department lead to their own department."
        >
          <Select
            value={shown}
            disabled={pending}
            onChange={(event) => change(event.target.value as BroadcastPolicyName)}
          >
            {POLICY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}
