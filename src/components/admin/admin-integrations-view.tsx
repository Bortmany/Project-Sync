// Admin → Integrations: one card per chat tool, where an administrator pastes the webhook address
// their own Slack or Teams channel gave them.
//
// The saved address is never sent back to this screen — only its scheme and host, followed by an
// ellipsis. Changing it therefore means pasting the whole thing again, which is exactly what the
// form asks for.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteIntegration,
  saveIntegration,
  sendTestMessage,
  setEventToggles,
  setIntegrationEnabled,
} from "@/components/actions";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, useToast } from "@/components/ui";
import type {
  IntegrationEventName,
  IntegrationEventToggles,
  IntegrationKindName,
  OrgIntegrationDTO,
} from "@/lib/zod-schemas";

const KIND_LABEL: Record<IntegrationKindName, string> = {
  SLACK: "Slack",
  TEAMS: "Microsoft Teams",
};

const KIND_INTRO: Record<IntegrationKindName, string> = {
  SLACK:
    "Posts a copy of the notifications you choose into one Slack channel, using an incoming webhook.",
  TEAMS:
    "Posts a copy of the notifications you choose into one Teams channel, using a Workflows webhook.",
};

/** Said on every card, because it is the thing an administrator most needs to know before pasting. */
const AUDIENCE_WARNING =
  "One channel receives headlines for every project in your company, not only the projects its members are on. Whoever can see that channel can see them, so choose a channel whose membership you are happy with.";

const URL_HINT: Record<IntegrationKindName, string> = {
  SLACK: "Starts with https://hooks.slack.com/services/",
  TEAMS: "The https address Teams gave you, containing logic.azure.com",
};

/** The setup steps, written from the current (2026) documented route for each tool. */
const SETUP_STEPS: Record<IntegrationKindName, string[]> = {
  SLACK: [
    "At api.slack.com/apps, create a Slack app in the workspace you want messages in, or open one you already have.",
    "Under OAuth & Permissions, add the incoming-webhook scope, then install the app to the workspace and pick the channel.",
    "Under Incoming Webhooks, copy the address Slack generates for that channel.",
    "Paste it below. Legacy custom-integration webhooks are being retired, so a Slack app is the route that keeps working.",
  ],
  TEAMS: [
    "In Teams, open the channel you want messages in and choose the “…” menu, then Workflows.",
    "Choose the template “Post to a channel when a webhook request is received”, pick the team and channel, and create it.",
    "Copy the address the workflow shows. It contains logic.azure.com and /triggers/manual/paths/invoke.",
    "Paste it below. The old Office 365 connector addresses (outlook.office.com/webhook/…) were retired in 2026 and no longer work.",
  ],
};

const EVENT_LABELS: { key: IntegrationEventName; label: string; hint: string }[] = [
  { key: "taskAssigned", label: "Task assigned", hint: "Somebody is given a task." },
  { key: "mention", label: "Mention", hint: "Somebody is named in a comment." },
  { key: "statusChange", label: "Status change", hint: "A task moves, is completed or reopened." },
  {
    key: "overdueReminder",
    label: "Deadline and overdue reminders",
    hint: "The hourly check for work due soon or already late.",
  },
  {
    key: "gateOverride",
    label: "Gate opened or override applied",
    hint: "Somebody records an authorised way past a completion rule.",
  },
];

function StatusBadge({ integration }: { integration: OrgIntegrationDTO }) {
  if (!integration.configured) return <Badge>Not configured</Badge>;
  return integration.enabled ? (
    <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
      Enabled
    </Badge>
  ) : (
    <Badge color="var(--brand-mid)">Disabled</Badge>
  );
}

function SetupSteps({ kind }: { kind: IntegrationKindName }) {
  return (
    <details className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] p-3">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-primary)]">
        How to get the {KIND_LABEL[kind]} address
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--brand-text)]">
        {SETUP_STEPS[kind].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-[var(--brand-gray)]">
        Treat the address as a password: anyone holding it can post into that channel. We never show
        it again once it is saved.
      </p>
    </details>
  );
}

function AddressForm({
  integration,
  onSaved,
}: {
  integration: OrgIntegrationDTO;
  onSaved: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [webhookUrl, setWebhookUrl] = useState("");

  function submit() {
    run(() => saveIntegration({ kind: integration.kind, webhookUrl: webhookUrl.trim() }), {
      success: `${KIND_LABEL[integration.kind]} address saved.`,
      failure: "Couldn't save that address. Try again.",
      onSuccess: () => {
        setWebhookUrl("");
        onSaved();
      },
    });
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorBanner message={error} /> : null}
      <Field
        label={integration.configured ? "Replace the address" : "Webhook address"}
        hint={URL_HINT[integration.kind]}
        error={fieldError(fieldErrors, "webhookUrl")}
      >
        <Input
          type="url"
          value={webhookUrl}
          placeholder="https://"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setWebhookUrl(event.target.value)}
        />
      </Field>
      <Button loading={pending} disabled={!webhookUrl.trim()} onClick={submit}>
        {integration.configured ? "Replace address" : "Save address"}
      </Button>
    </div>
  );
}

function EventToggleList({
  integration,
  onChanged,
}: {
  integration: OrgIntegrationDTO;
  onChanged: () => void;
}) {
  const { run, pending } = useAction();

  function toggle(key: IntegrationEventName, next: boolean) {
    const eventToggles: IntegrationEventToggles = { ...integration.eventToggles, [key]: next };
    run(() => setEventToggles({ kind: integration.kind, eventToggles }), {
      failure: "Couldn't change that. Try again.",
      onSuccess: onChanged,
    });
  }

  return (
    <fieldset className="space-y-2" disabled={pending}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
        What gets sent
      </legend>
      {EVENT_LABELS.map((event) => (
        <label key={event.key} className="flex items-start gap-2 text-sm text-[var(--brand-text)]">
          <input
            type="checkbox"
            className="mt-1"
            checked={integration.eventToggles[event.key]}
            onChange={(input) => toggle(event.key, input.target.checked)}
          />
          <span>
            <span className="font-medium text-[var(--brand-ink)]">{event.label}</span>
            <span className="block text-xs text-[var(--brand-gray)]">{event.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function ConnectedControls({
  integration,
  onChanged,
}: {
  integration: OrgIntegrationDTO;
  onChanged: () => void;
}) {
  const { run, pending } = useAction();
  const { show } = useToast();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function switchTo(enabled: boolean) {
    run(() => setIntegrationEnabled({ kind: integration.kind, enabled }), {
      success: enabled
        ? `${KIND_LABEL[integration.kind]} notifications are on.`
        : `${KIND_LABEL[integration.kind]} notifications are off.`,
      failure: "Couldn't change that. Try again.",
      onSuccess: onChanged,
    });
  }

  // The result carries its own plain-English sentence — whether the card arrived or why it did
  // not — so it is shown instead of a fixed message.
  function test() {
    run(() => sendTestMessage({ kind: integration.kind }), {
      failure: "Couldn't send the test message. Try again.",
      onSuccess: (result) => {
        show(result.message, result.delivered ? "success" : "error");
        onChanged();
      },
    });
  }

  function remove() {
    run(() => deleteIntegration({ kind: integration.kind }), {
      success: `${KIND_LABEL[integration.kind]} connection removed.`,
      failure: "Couldn't remove that connection. Try again.",
      onSuccess: () => {
        setConfirmingRemove(false);
        onChanged();
      },
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" loading={pending} onClick={() => switchTo(!integration.enabled)}>
          {integration.enabled ? "Switch off" : "Switch on"}
        </Button>
        <Button variant="ghost" loading={pending} onClick={test}>
          Send test message
        </Button>
        <Button variant="ghost" loading={pending} onClick={() => setConfirmingRemove(true)}>
          Remove
        </Button>
      </div>

      {confirmingRemove ? (
        <Modal
          open
          size="sm"
          title={`Remove ${KIND_LABEL[integration.kind]}?`}
          onClose={() => setConfirmingRemove(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </Button>
              <Button loading={pending} onClick={remove}>
                Remove
              </Button>
            </>
          }
        >
          <p className="text-sm text-[var(--brand-text)]">
            The saved address is deleted and nothing more is posted to that channel. Notifications
            inside Tielora are unaffected. To connect it again you will need to paste a fresh
            address.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function IntegrationCard({ integration }: { integration: OrgIntegrationDTO }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <Card title={KIND_LABEL[integration.kind]} action={<StatusBadge integration={integration} />}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--brand-text)]">{KIND_INTRO[integration.kind]}</p>
        <p className="text-xs text-[var(--brand-gray)]">{AUDIENCE_WARNING}</p>

        {integration.configured ? (
          <p className="text-sm text-[var(--brand-gray)]">
            Saved address:{" "}
            <span className="font-mono text-[var(--brand-ink)]">
              {integration.webhookUrlMasked}
            </span>
          </p>
        ) : null}

        <SetupSteps kind={integration.kind} />
        <AddressForm integration={integration} onSaved={refresh} />

        {integration.configured ? (
          <>
            <EventToggleList integration={integration} onChanged={refresh} />
            <ConnectedControls integration={integration} onChanged={refresh} />
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function AdminIntegrationsView({ integrations }: { integrations: OrgIntegrationDTO[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Integrations</h1>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Send a copy of your company&rsquo;s notifications to a chat channel. Notifications inside
          Tielora carry on either way — this is an extra copy, not a replacement.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.kind} integration={integration} />
        ))}
      </div>
    </div>
  );
}
