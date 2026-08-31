// Your account → the danger zone: deleting your own account.
//
// Two deliberate choices live in this file:
//  - The typed confirmation is the fixed word DELETE, not the person's own email address. One
//    string everybody can type correctly under stress, and the same disabled-until-it-matches
//    mechanic the admin dialogs already use.
//  - The sole-administrator guidance is shown BEFORE anybody types anything, and the button stays
//    enabled anyway. Nothing in this app is ever offered greyed out; the server refuses it too, and
//    that refusal is the one that counts.

"use client";

import { useState } from "react";
import { deleteMyAccount } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal } from "@/components/ui";
import { ACCOUNT_DELETE_CONFIRMATION } from "@/lib/zod-schemas";

/** Where the browser lands once the account is gone. The login page says the rest. */
const AFTER = "/login?done=account-deleted";

export function DeleteAccountCard({ soleAdmin }: { soleAdmin: boolean }) {
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { run, pending, error } = useAction();

  const matches = typed === ACCOUNT_DELETE_CONFIRMATION;

  function remove() {
    run(() => deleteMyAccount({ confirm: typed }), {
      failure: "Couldn't delete your account. Try again.",
      onSuccess: () => {
        // A full page load rather than a client navigation: the session this tab was holding no
        // longer exists, so there is nothing left worth keeping in memory.
        window.location.assign(AFTER);
      },
    });
  }

  return (
    <>
      <Card
        title="Delete my account"
        className="border-[var(--status-blocked)]/30 bg-[var(--status-blocked)]/5"
        action={<Badge color="var(--status-blocked)">Danger zone</Badge>}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--brand-text)]">
            Deleting your account signs you out and takes your personal details off Tielora: your
            name becomes &ldquo;Former member&rdquo; and your email address is removed. It
            doesn&rsquo;t erase your work, though — your comments, the tasks you completed, and
            every document revision you uploaded stay exactly where they are, because they&rsquo;re
            part of your company&rsquo;s permanent project record, the same as everyone else&rsquo;s.
            They&rsquo;ll show &ldquo;Former member&rdquo; instead of your name. Entries already
            recorded in the activity trail keep the name they were written with at the time, because
            that trail is a record of what happened and is never rewritten.
          </p>

          {soleAdmin ? (
            <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]">
              You&rsquo;re the only administrator here, so deleting your account would leave nobody
              able to manage Tielora for your company.{" "}
              <a
                href="/admin/users"
                className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
              >
                Make someone else an administrator first
              </a>
              , then come back here.
            </p>
          ) : null}

          {error ? <ErrorBanner message={error} /> : null}

          <Field
            label={`Type ${ACCOUNT_DELETE_CONFIRMATION} to confirm`}
            hint={`Type ${ACCOUNT_DELETE_CONFIRMATION} exactly.`}
          >
            <Input
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>

          <Button variant="danger" disabled={!matches} onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        </div>
      </Card>

      {confirming ? (
        <Modal
          open
          size="sm"
          title="Delete your account?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={pending} onClick={remove}>
                Delete my account
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {error ? <ErrorBanner message={error} /> : null}
            <p>
              Your name and email address are removed, and your work shows &ldquo;Former
              member&rdquo; instead. Your comments, completed work and uploaded documents stay on
              your company&rsquo;s record, and the activity trail keeps the entries it has already
              written.
            </p>
            <p>You&rsquo;ll be signed out immediately.</p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
