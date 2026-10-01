// Admin → Integrations: the "AI" card. Two switches (Ask Tielora, AI-written briefs), both off for
// every company until an administrator turns them on, a plain statement of what is sent to
// Anthropic, and the company's monthly allowance.
//
// Drawn only when this deployment has the AI key (the page hands over `null` otherwise, and nothing
// is drawn: not greyed out, no gap). Administrators only: the page is behind MANAGE_INTEGRATIONS.
// Turning a switch ON asks first, because it is the moment the company agrees to project
// information going to an outside company; turning it OFF takes effect at once and needs no asking.

"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAiSettings } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { formatDateUtc } from "@/components/format";
import { Badge, Button, Card, Modal } from "@/components/ui";
import type { AiSettingsDTO } from "@/lib/zod-schemas";

type SwitchKey = "aiAssistant" | "aiBriefs";

const SWITCHES: { key: SwitchKey; label: string; hint: string; confirmTitle: string; on: string; off: string }[] = [
  {
    key: "aiAssistant",
    label: "Ask Tielora",
    hint: "People on your team can ask questions about the projects they are on. Administrators can ask about every project in the company. Contractors never see it. Answers can be wrong.",
    confirmTitle: "Turn on Ask Tielora?",
    on: "Ask Tielora is on. Your team can now ask questions about their projects.",
    off: "Ask Tielora is off. The Ask Tielora button is gone from every page.",
  },
  {
    key: "aiBriefs",
    label: "AI-written briefs",
    hint: "The daily and weekly brief opens with two or three sentences written by AI, above the usual lines. If the AI is unavailable or your allowance is used up, the brief goes out as normal.",
    confirmTitle: "Turn on AI-written briefs?",
    on: "AI-written briefs are on. The next daily brief will open with a short summary.",
    off: "AI-written briefs are off. Briefs go out as before.",
  },
];

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

const LINK_CLASS = "inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)] underline";

export function AdminAiCard({
  settings,
  usedUsd,
  atAllowance: atCap,
  resetsOn,
}: {
  settings: AiSettingsDTO;
  usedUsd: number;
  /** Server-computed, same rule as the refusal. */
  atAllowance: boolean;
  resetsOn: Date;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [values, setValues] = useState<Record<SwitchKey, boolean>>({
    aiAssistant: settings.aiAssistant,
    aiBriefs: settings.aiBriefs,
  });
  const [confirming, setConfirming] = useState<SwitchKey | null>(null);

  const anyOn = values.aiAssistant || values.aiBriefs;
  const noAllowance = settings.monthlyUsd <= 0;
  const atAllowance = !noAllowance && atCap;

  function change(key: SwitchKey, next: boolean) {
    const entry = SWITCHES.find((item) => item.key === key);
    if (!entry) return;
    run(() => setAiSettings({ [key]: next }), {
      success: next ? entry.on : entry.off,
      failure: "Couldn't change that. Try again.",
      onSuccess: (saved) => {
        setValues({ aiAssistant: saved.aiAssistant, aiBriefs: saved.aiBriefs });
        setConfirming(null);
        router.refresh();
      },
    });
  }

  const confirmEntry = SWITCHES.find((item) => item.key === confirming);

  return (
    <Card
      id="ai"
      title="AI"
      action={
        anyOn ? (
          <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
            On
          </Badge>
        ) : (
          <Badge color="var(--brand-mid)">Off</Badge>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--brand-text)]">
          Let your team ask questions about their projects, and add a short written summary to your
          daily and weekly brief. Both are off until you switch them on.
        </p>

        {noAllowance ? (
          <p className="text-sm text-[var(--brand-ink)]">
            Your plan doesn&rsquo;t include AI. There is nothing to switch on.
          </p>
        ) : (
          <>
            <fieldset className="space-y-2" disabled={pending}>
              <legend className="sr-only">AI switches</legend>
              {SWITCHES.map((item) => (
                <label key={item.key} className="flex min-h-11 items-start gap-2 text-sm text-[var(--brand-text)]">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={values[item.key]}
                    onChange={(input) => {
                      // Switching on asks first; switching off needs no confirmation.
                      if (input.target.checked) setConfirming(item.key);
                      else change(item.key, false);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-bold text-[var(--brand-ink)]">{item.label}</span>
                    <span className="block break-words text-xs text-[var(--brand-text)]">{item.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="space-y-1">
              <p className="break-words text-xs text-[var(--brand-text)]">
                What is sent to Anthropic: when someone asks a question, or a brief is written, the
                question and the project names, codes, deadlines, progress figures and task titles it
                needs are sent to Anthropic. People&rsquo;s names, email addresses, comments and
                documents are never sent. Tielora does not save questions or answers. Please tell your
                team not to type personal or confidential details into a question.
              </p>
              <Link href="/privacy" className={LINK_CLASS}>
                Read our Privacy page
              </Link>
            </div>
          </>
        )}

        {!noAllowance ? (
          <p className="text-sm text-[var(--brand-ink)]">
            Your plan&rsquo;s monthly allowance is {dollars(settings.monthlyUsd)}. Used so far this month:{" "}
            {dollars(usedUsd)}.
          </p>
        ) : null}
        {atAllowance ? (
          <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]">
            Your company has used its AI allowance for this month. Both switches stay as they are and
            start working again on {formatDateUtc(resetsOn)}.
          </p>
        ) : null}
        <Link href="/admin/billing" className={LINK_CLASS}>
          See Admin → Billing
        </Link>
      </div>

      {confirmEntry ? (
        <Modal
          open
          size="sm"
          title={confirmEntry.confirmTitle}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="ghost" className="min-h-11" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button className="min-h-11" loading={pending} onClick={() => change(confirmEntry.key, true)}>
                Turn on
              </Button>
            </>
          }
        >
          <p className="text-sm text-[var(--brand-text)]">
            Turning this on sends project information to Anthropic, our AI provider, to write each
            answer. Turning it off again takes effect straight away.
          </p>
        </Modal>
      ) : null}
    </Card>
  );
}
