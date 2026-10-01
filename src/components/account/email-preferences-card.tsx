// Your account → Email: which emails Tielora sends to the signed-in person.
//
// Read on the server (`emailPreferencesFor`) so it is right on the first paint, and only ever drawn
// when this Tielora sends email at all — while it does not, the page leaves this card out entirely.
// Each box saves the moment it is pressed; the group is disabled while one save is in flight, and a
// failed save puts the box back.
//
// Emails only ever go to a confirmed address, so an unconfirmed person sees their stored choices
// greyed out, with a calm strip and a button to send the confirmation link again.
//
// A contractor (EXTERNAL) sees the Alerts row only, with its own words: they are never sent a daily
// or weekly brief, and there is no space where those rows would be.

"use client";

import { useState } from "react";
import { resendVerificationEmail, setEmailPreferences } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { Button, Card, Spinner, useToast } from "@/components/ui";
import type { EmailPreferencesDTO, EmailPreferencesInput } from "@/lib/zod-schemas";

type RowKey = "emailAlerts" | "emailDailyBrief" | "emailWeeklyBrief";

type Row = {
  key: RowKey;
  label: string;
  helper: string;
  /** The success toasts, switched on and off. */
  on: string;
  off: string;
};

const ALERTS: Row = {
  key: "emailAlerts",
  label: "Alerts",
  helper:
    "An email for things that need you: a task assigned to you, a mention, a change to your work, a deadline coming up or missed, a gate opened, and company announcements. One email for each notification you would see in Tielora.",
  on: "Alert emails are on. We will email you when something needs you.",
  off: "Alert emails are off.",
};

/** A contractor is only ever emailed about work assigned to them — never announcements at large. */
const CONTRACTOR_ALERTS: Row = {
  ...ALERTS,
  helper:
    "An email for work assigned to you: a new task, a change to it, a deadline coming up or missed, or work sent back for more.",
};

const DAILY_BRIEF: Row = {
  key: "emailDailyBrief",
  label: "Daily brief",
  helper:
    "Your day, each morning (early morning UTC): what is due, overdue, newly unblocked and waiting for your review. Nothing is sent on a day when there is nothing to say.",
  on: "Daily brief is on. Your first one arrives tomorrow morning.",
  off: "Daily brief is off.",
};

const WEEKLY_BRIEF: Row = {
  key: "emailWeeklyBrief",
  label: "Weekly brief",
  helper:
    "A summary every Monday morning (early morning UTC) of the projects you belong to: how far each has come since last week, what became late, which gates opened and which required documents are missing. Nothing is sent if you are on no active project.",
  on: "Weekly brief is on. Your first one arrives next Monday.",
  off: "Weekly brief is off.",
};

const SAVE_FAILED = "Couldn't save that. Try again.";

/** A "slow down" answer carries its own plain sentence, which is worth showing as it is. */
function isWaitAWhile(message: string): boolean {
  return /wait/i.test(message) || message.startsWith("Too many");
}

export function EmailPreferencesCard({
  preferences,
  external,
}: {
  preferences: EmailPreferencesDTO;
  /** A contractor: the Alerts row only. */
  external: boolean;
}) {
  const { show } = useToast();
  const [values, setValues] = useState<Record<RowKey, boolean>>({
    emailAlerts: preferences.emailAlerts,
    emailDailyBrief: preferences.emailDailyBrief,
    emailWeeklyBrief: preferences.emailWeeklyBrief,
  });
  const [saving, setSaving] = useState<RowKey | null>(null);
  const resend = useAction();
  const [sent, setSent] = useState(false);

  // Invisible means invisible: the page does not mount this while email is not set up, and the
  // card agrees with it.
  if (!preferences.available) return null;

  const rows = external ? [CONTRACTOR_ALERTS] : [ALERTS, DAILY_BRIEF, WEEKLY_BRIEF];
  const locked = !preferences.verified;

  async function toggle(row: Row, next: boolean) {
    const before = values[row.key];
    setValues((current) => ({ ...current, [row.key]: next }));
    setSaving(row.key);

    const input: EmailPreferencesInput = { [row.key]: next };
    let error: string | null = null;
    try {
      const result = await setEmailPreferences(input);
      if (result.ok) {
        setValues({
          emailAlerts: result.data.emailAlerts,
          emailDailyBrief: result.data.emailDailyBrief,
          emailWeeklyBrief: result.data.emailWeeklyBrief,
        });
      } else {
        error = isWaitAWhile(result.error) ? result.error : SAVE_FAILED;
      }
    } catch {
      error = SAVE_FAILED;
    }

    if (error) {
      setValues((current) => ({ ...current, [row.key]: before }));
      show(error, "error");
    } else {
      show(next ? row.on : row.off, "success");
    }
    setSaving(null);
  }

  function sendConfirmation() {
    resend.run(() => resendVerificationEmail(), {
      failure: "Couldn't send that email. Try again shortly.",
      onSuccess: () => setSent(true),
    });
  }

  return (
    <Card title="Email">
      <div className="space-y-4">
        <p className="min-w-0 break-words text-sm text-[var(--brand-text)]">
          Emails go to{" "}
          <span className="font-semibold text-[var(--brand-ink)]">{preferences.email}</span>.
        </p>

        {locked ? (
          <div className="space-y-3">
            <p
              role="status"
              className="break-words rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]"
            >
              {sent
                ? `We have sent a link to ${preferences.email}. Check your inbox.`
                : "Confirm your email address first — we only send these to an address you have confirmed."}
            </p>
            {sent ? null : (
              <Button
                variant="secondary"
                loading={resend.pending}
                className="min-h-11 w-full sm:w-auto"
                onClick={sendConfirmation}
              >
                {resend.pending ? "Sending…" : "Send me a confirmation email"}
              </Button>
            )}
          </div>
        ) : null}

        <fieldset disabled={locked || saving !== null} className="space-y-1">
          <legend className="sr-only">Email preferences</legend>
          {rows.map((row) => (
            <label
              key={row.key}
              title={`${row.label}. You can change this any time.`}
              className={`flex min-h-11 items-start gap-3 py-2 ${
                locked ? "cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand-primary)]"
                checked={values[row.key]}
                onChange={(event) => void toggle(row, event.target.checked)}
              />
              <span className="min-w-0">
                <span
                  className={`flex items-center gap-2 text-sm font-semibold ${
                    locked ? "text-[var(--brand-gray)]" : "text-[var(--brand-ink)]"
                  }`}
                >
                  {row.label}
                  {saving === row.key ? <Spinner size={16} /> : null}
                </span>
                <span
                  className={`block break-words text-xs ${
                    locked ? "text-[var(--brand-gray)]" : "text-[var(--brand-text)]"
                  }`}
                >
                  {row.helper}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="text-xs text-[var(--brand-text)]">
          Every email has a one-click unsubscribe link.
        </p>
      </div>
    </Card>
  );
}
