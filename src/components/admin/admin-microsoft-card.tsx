// Admin → Integrations: the Microsoft 365 card, in two labelled parts that work without each other.
//
//  1. "Sign in with Microsoft" — lets the company's people sign in with the Microsoft work account
//     they already use. Switching it ON is a browser journey (the administrator signs in to
//     Microsoft AS THEMSELVES and the company's tenant is read from that sign-in, never typed), so it
//     is a link to /api/auth/microsoft/enable. Switching it OFF is a server action behind a confirm.
//  2. "OneDrive and SharePoint files" — connect the company's OneDrive and SharePoint so people can
//     attach files that already live there. Unchanged apart from its heading moving into the part.
//
// The card never sees a token, a tenant id or anybody's Microsoft id — only the work domain, who
// switched things on and when, and a count. Every Microsoft door is an ordinary link, not a fetch:
// signing in happens on Microsoft's own pages and comes back to our callback, so nothing about the
// strict Content-Security-Policy needs relaxing and no Microsoft JavaScript is ever loaded.

"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { disableMicrosoftSignIn, disconnectMicrosoft } from "@/components/actions";
import { formatDate } from "@/components/format";
import { useAction } from "@/components/hooks/use-action";
import { Badge, Button, Card, ErrorBanner, Modal } from "@/components/ui";
import type { MicrosoftConnectionDTO, MicrosoftSignInStatusDTO } from "@/lib/zod-schemas";

/** What the files callback puts in the address bar, in plain English. */
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

/**
 * What the sign-in callback puts in the address bar after "Switch on" (`?microsoftSignIn=`), in
 * plain English. "enabled" is written separately because it names the company's domain.
 */
const SIGN_IN_OUTCOME_MESSAGES: Record<string, string> = {
  denied: "The Microsoft sign-in was cancelled, so nothing was changed.",
  mismatch:
    "Sign in with the Microsoft account that uses the same email address as your Tielora account, then try again.",
  taken:
    "That Microsoft company is already linked to another Tielora workspace. If that is a mistake, contact Tielora support.",
  switchOffFirst: "Switch it off first, then switch it on with the Microsoft account you want.",
  failed: "Microsoft could not complete that. Try again.",
};

const SETUP_STEPS = [
  "Press Connect and sign in with a Microsoft work account that can see the files your team needs.",
  "If you are a Microsoft 365 administrator, tick “Consent on behalf of your organisation” so the approval covers your whole company.",
  "Approve the two permissions Tielora asks for: read the files that account can already see, and stay signed in.",
  "You come straight back here. Everyone who can upload to a task then gets an “Attach from OneDrive or SharePoint” tab in the upload box.",
];

const AUDIENCE_WARNING =
  "Everyone browses through the account that connects. They can only attach files to tasks they could already upload to, but the list of files they see is what that one account can see — so connect with an account whose access you are happy to share.";

/** The primary "Connect"-style link, 44px tall so it is comfortable to press on a phone. */
const PRIMARY_LINK =
  "inline-flex min-h-11 items-center rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-mid)]";

/** Today's words for "APP_BASE_URL is not set", shared by both parts. */
function BaseUrlMissing() {
  return (
    <p className="text-sm text-[var(--brand-text)]">
      This site&rsquo;s own web address has not been set yet, so Microsoft has nowhere to send you
      back to. Ask whoever runs this Tielora to set <code>APP_BASE_URL</code>, then come back here.
    </p>
  );
}

/** The accent-tinted "good news" strip. */
function GoodStrip({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="break-words rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-ink)]"
    >
      {message}
    </p>
  );
}

/** A part's header row: heading at the start, its own badge at the reading end. */
function PartHeader({ title, badge }: { title: string; badge: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-[var(--brand-ink)]">{title}</h3>
      {badge}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Part 1 — Sign in with Microsoft                                     */
/* ------------------------------------------------------------------ */

/** "12 people have signed in with Microsoft so far." */
function linkedSentence(count: number): string {
  if (count === 0) return "Nobody has signed in with Microsoft yet.";
  if (count === 1) return "1 person has signed in with Microsoft so far.";
  return `${count} people have signed in with Microsoft so far.`;
}

/** "(12 people at the moment)" */
function linkedAtTheMoment(count: number): string {
  if (count === 0) return "nobody at the moment";
  if (count === 1) return "1 person at the moment";
  return `${count} people at the moment`;
}

function SignInPart({
  status,
  outcome,
  emailAvailable,
}: {
  status: MicrosoftSignInStatusDTO;
  outcome?: string;
  emailAvailable: boolean;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);
  // Kept from the first render: the address parameter is removed below, and a refresh after
  // switching off must not bring an old banner back.
  const [shownOutcome, setShownOutcome] = useState(outcome);
  const cancelId = useId();

  // Shown once: take `?microsoftSignIn=` out of the address so a refresh shows the ordinary card.
  useEffect(() => {
    if (!outcome) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("microsoftSignIn")) return;
    url.searchParams.delete("microsoftSignIn");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [outcome]);

  // Coming back with the browser's Back button restores the page from memory, still "opening".
  useEffect(() => {
    const reset = () => setOpening(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  // Cancel is the first thing focused in the confirm — the safe answer is the easy one. This runs
  // after the Modal's own effect, which focuses the dialog itself.
  useEffect(() => {
    if (confirming) document.getElementById(cancelId)?.focus();
  }, [confirming, cancelId]);

  function switchOff() {
    run(() => disableMicrosoftSignIn(), {
      success: "Sign in with Microsoft is off. Everyone signs in with their password again.",
      failure: "Couldn't switch that off. Try again.",
      onSuccess: () => {
        setConfirming(false);
        setShownOutcome(undefined);
        router.refresh();
      },
    });
  }

  let banner: ReactNode = null;
  if (shownOutcome === "enabled") {
    banner = (
      <GoodStrip
        message={
          status.domain
            ? `Sign in with Microsoft is on for your company (${status.domain}).`
            : "Sign in with Microsoft is on for your company."
        }
      />
    );
  } else if (shownOutcome && SIGN_IN_OUTCOME_MESSAGES[shownOutcome]) {
    banner = <ErrorBanner message={SIGN_IN_OUTCOME_MESSAGES[shownOutcome]} />;
  }

  return (
    <section className="space-y-4 pb-4">
      <PartHeader
        title="Sign in with Microsoft"
        badge={
          status.enabled ? (
            <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
              On
            </Badge>
          ) : (
            <Badge color="var(--brand-mid)">Off</Badge>
          )
        }
      />

      {banner}
      {error && !confirming ? <ErrorBanner message={error} /> : null}

      {status.enabled ? (
        <>
          <dl className="grid gap-1 text-sm text-[var(--brand-text)]">
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="font-semibold text-[var(--brand-ink)]">Microsoft company:</dt>
              <dd className="min-w-0 break-words">{status.domain ?? "Linked"}</dd>
            </div>
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="font-semibold text-[var(--brand-ink)]">Switched on by:</dt>
              <dd className="min-w-0 break-words">
                {status.enabledByName ?? "Someone who has since left"}
                {status.enabledAt ? ` on ${formatDate(new Date(status.enabledAt))}` : ""}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-[var(--brand-text)]">{linkedSentence(status.linkedPeople)}</p>
          <Button
            variant="ghost"
            className="min-h-11"
            title="Switch off Sign in with Microsoft for everyone"
            onClick={() => setConfirming(true)}
          >
            Switch off
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--brand-text)]">
            Let your people sign in with the Microsoft work account they already use. They still
            need a Tielora account — this does not create one.
          </p>
          <p className="text-xs text-[var(--brand-text)]">
            You will sign in to Microsoft with your own work account. Use the same email address you
            use here.
          </p>
          {status.callbackReady ? (
            <div>
              <a
                href="/api/auth/microsoft/enable"
                title="Sign in to Microsoft to link your company"
                aria-busy={opening ? "true" : undefined}
                onClick={() => setOpening(true)}
                className={`${PRIMARY_LINK} ${opening ? "pointer-events-none" : ""}`}
              >
                {opening ? "Opening Microsoft…" : "Switch on"}
              </a>
            </div>
          ) : (
            <BaseUrlMissing />
          )}
        </>
      )}

      {confirming ? (
        <Modal
          open
          size="sm"
          title="Switch off Sign in with Microsoft?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button
                id={cancelId}
                variant="ghost"
                className="min-h-11"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button loading={pending} className="min-h-11" onClick={switchOff}>
                Switch off
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {error ? <ErrorBanner message={error} /> : null}
            <p className="text-sm text-[var(--brand-text)]">
              Everyone will sign in with their password again. Each person&rsquo;s Microsoft link
              is removed ({linkedAtTheMoment(status.linkedPeople)}), so if you switch it back on,
              people link again the first time they sign in. Nobody is signed out right now.
              {emailAvailable
                ? " Anyone who has forgotten their password can use “Forgot password?” on the sign-in page."
                : ""}
            </p>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Part 2 — OneDrive and SharePoint files                              */
/* ------------------------------------------------------------------ */

function StatusBadge({ connection }: { connection: MicrosoftConnectionDTO }) {
  if (!connection.connected) return <Badge>Not connected</Badge>;
  if (connection.needsReconnect) return <Badge color="var(--brand-mid)">Needs reconnecting</Badge>;
  return (
    <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
      Connected
    </Badge>
  );
}

function FilesPart({
  connection,
  outcome,
}: {
  connection: MicrosoftConnectionDTO;
  outcome?: string;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [confirming, setConfirming] = useState(false);

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
    <section className="space-y-4 pt-4">
      <PartHeader
        title="OneDrive and SharePoint files"
        badge={<StatusBadge connection={connection} />}
      />
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
          <a href="/api/integrations/microsoft/connect" className={PRIMARY_LINK}>
            {connection.connected ? "Connect again" : "Connect"}
          </a>
          {connection.connected ? (
            <Button variant="ghost" loading={pending} onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          ) : null}
        </div>
      ) : (
        <BaseUrlMissing />
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
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

export function AdminMicrosoftCard({
  connection,
  outcome,
  signIn,
  signInOutcome,
  emailAvailable,
}: {
  connection: MicrosoftConnectionDTO;
  /** `?microsoft=` from the files callback. */
  outcome?: string;
  signIn: MicrosoftSignInStatusDTO;
  /** `?microsoftSignIn=` from the sign-in callback after "Switch on". */
  signInOutcome?: string;
  /** Whether this Tielora sends email — decides whether the confirm mentions "Forgot password?". */
  emailAvailable: boolean;
}) {
  // Dormant: no Azure app registered on this Tielora, so there is nothing here to offer.
  if (!connection.available) return null;

  return (
    <Card id="microsoft-365" title="Microsoft 365">
      <div className="divide-y divide-[var(--border)]">
        <SignInPart status={signIn} outcome={signInOutcome} emailAvailable={emailAvailable} />
        <FilesPart connection={connection} outcome={outcome} />
      </div>
    </Card>
  );
}
