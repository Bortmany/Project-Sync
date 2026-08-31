// Admin → Integrations: the Microsoft 365 card, where an administrator connects their company's
// OneDrive and SharePoint so people can attach files that already live there.
//
// The card never sees a token — only the work domain, who connected and when. "Connect" is an
// ordinary link, not a fetch: signing in happens on Microsoft's own pages and comes back to our
// callback, so nothing about the strict Content-Security-Policy needs relaxing and no Microsoft
// JavaScript is ever loaded into this app.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectMicrosoft } from "@/components/actions";
import { formatDate } from "@/components/format";
import { useAction } from "@/components/hooks/use-action";
import { Badge, Button, Card, ErrorBanner, Modal } from "@/components/ui";
import type { MicrosoftConnectionDTO } from "@/lib/zod-schemas";

/** What the callback puts in the address bar, in plain English. */
const OUTCOME_MESSAGES: Record<string, { text: string; tone: "good" | "bad" }> = {
  connected: { text: "Microsoft 365 is connected.", tone: "good" },
  denied: { text: "The Microsoft sign-in was cancelled, so nothing was connected.", tone: "bad" },
  failed: {
    text: "Microsoft could not complete the connection. Try again, and check the app has the Files.Read.All and offline_access permissions.",
    tone: "bad",
  },
  setup: {
    text: "This site's own address has not been set, so Microsoft has nowhere to send people back to. Ask whoever runs this Tielora to set APP_BASE_URL.",
    tone: "bad",
  },
};

const SETUP_STEPS = [
  "Press Connect and sign in with a Microsoft work account that can see the files your team needs.",
  "If you are a Microsoft 365 administrator, tick “Consent on behalf of your organisation” so the approval covers your whole company.",
  "Approve the two permissions Tielora asks for: read the files that account can already see, and stay signed in.",
  "You come straight back here. Everyone who can upload to a task then gets an “Attach from OneDrive or SharePoint” tab in the upload box.",
];

const AUDIENCE_WARNING =
  "Everyone browses through the account that connects. They can only attach files to tasks they could already upload to, but the list of files they see is what that one account can see — so connect with an account whose access you are happy to share.";

function StatusBadge({ connection }: { connection: MicrosoftConnectionDTO }) {
  if (!connection.connected) return <Badge>Not connected</Badge>;
  if (connection.needsReconnect) return <Badge color="var(--brand-mid)">Needs reconnecting</Badge>;
  return (
    <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
      Connected
    </Badge>
  );
}

export function AdminMicrosoftCard({
  connection,
  outcome,
}: {
  connection: MicrosoftConnectionDTO;
  outcome?: string;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [confirming, setConfirming] = useState(false);

  // Dormant: no Azure app registered on this Tielora, so there is nothing here to offer.
  if (!connection.available) return null;

  const message = outcome ? OUTCOME_MESSAGES[outcome] : undefined;

  function remove() {
    run(() => disconnectMicrosoft(), {
      success: "Microsoft 365 disconnected.",
      failure: "Couldn't disconnect. Try again.",
      onSuccess: () => {
        setConfirming(false);
        router.refresh();
      },
    });
  }

  return (
    <Card
      title="Microsoft 365 (OneDrive and SharePoint)"
      action={<StatusBadge connection={connection} />}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--brand-text)]">
          Lets your team attach a document that already lives in your company&rsquo;s OneDrive or
          SharePoint, without downloading it first. The file is copied into Tielora as an ordinary
          revision, so it stays here even if the original is moved or deleted.
        </p>
        <p className="text-xs text-[var(--brand-gray)]">{AUDIENCE_WARNING}</p>

        {message ? (
          message.tone === "bad" ? (
            <ErrorBanner message={message.text} />
          ) : (
            <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-ink)]">
              {message.text}
            </p>
          )
        ) : null}

        {error ? <ErrorBanner message={error} /> : null}

        {connection.needsReconnect ? (
          <ErrorBanner message="Microsoft has stopped accepting the saved sign-in. Connect again to switch attachments back on." />
        ) : null}

        {connection.connected ? (
          <dl className="grid gap-1 text-sm text-[var(--brand-text)]">
            <div className="flex gap-2">
              <dt className="font-semibold text-[var(--brand-ink)]">Microsoft 365 account:</dt>
              <dd>{connection.tenantDomain ?? "A Microsoft work account"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold text-[var(--brand-ink)]">Connected by:</dt>
              <dd>
                {connection.connectedByName ?? "Someone who has since left"}
                {connection.connectedAt ? ` on ${formatDate(connection.connectedAt)}` : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <details className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] p-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-primary)]">
              What happens when you connect
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--brand-text)]">
              {SETUP_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        )}

        {connection.callbackReady ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/integrations/microsoft/connect"
              className="inline-flex items-center rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-mid)]"
            >
              {connection.connected ? "Connect again" : "Connect"}
            </a>
            {connection.connected ? (
              <Button variant="ghost" loading={pending} onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--brand-text)]">
            This site&rsquo;s own web address has not been set yet, so Microsoft has nowhere to send
            you back to. Ask whoever runs this Tielora to set <code>APP_BASE_URL</code>, then come
            back here.
          </p>
        )}

        {confirming ? (
          <Modal
            open
            size="sm"
            title="Disconnect Microsoft 365?"
            onClose={() => setConfirming(false)}
            footer={
              <>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button loading={pending} onClick={remove}>
                  Disconnect
                </Button>
              </>
            }
          >
            <p className="text-sm text-[var(--brand-text)]">
              The saved sign-in is deleted and nobody can attach OneDrive or SharePoint files any
              more. Documents already attached stay exactly where they are — they are ordinary
              revisions in Tielora now. To switch it back on, connect again.
            </p>
          </Modal>
        ) : null}
      </div>
    </Card>
  );
}
