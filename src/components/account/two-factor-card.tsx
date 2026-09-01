// Your account → two-factor sign-in: turning it on, replacing the recovery codes, turning it off.
//
// Three deliberate choices live in this file:
//  - **The recovery codes are shown once and the screen says so.** While they are on screen the
//    modal refuses to close by the X, the backdrop or Escape: it asks the person to press "I've
//    saved these codes" instead. Closing by accident would cost them the only copy there will ever
//    be.
//  - **Turning it off asks for the second factor, never the password.** The server insists on the
//    same thing; this is the screen saying it in the same words.
//  - **A rate-limit refusal is shown in the calm accent strip rather than the red banner**, with
//    the server's own sentence — waiting a minute is not an error, and the wording still arrives
//    from the server rather than being rewritten here.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  regenerateRecoveryCodes,
} from "@/components/actions";
import { formatDate } from "@/components/format";
import { useAction } from "@/components/hooks/use-action";
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, Spinner, useToast } from "@/components/ui";
import type { TwoFactorEnrollmentDTO } from "@/lib/zod-schemas";

/** Below this many unused recovery codes the card asks somebody to make fresh ones. */
const LOW_CODES = 2;

const WRONG_CODE = "That code was not right. Try again.";

/** A refusal that is really "slow down" rather than "no". Shown calmly, in the server's own words. */
function isWaitAWhile(message: string | null): boolean {
  return message !== null && (message.startsWith("Too many") || message.includes("wait"));
}

function CalmStrip({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]"
    >
      {message}
    </p>
  );
}

/** The one place a refusal is drawn, so every modal in this file treats "wait" the same way. */
function Refusal({ message }: { message: string | null }) {
  if (!message) return null;
  return isWaitAWhile(message) ? <CalmStrip message={message} /> : <ErrorBanner message={message} />;
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

export function TwoFactorCard({
  enabled,
  enabledAt,
  recoveryCodesLeft,
}: {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryCodesLeft: number;
}) {
  const [enrolling, setEnrolling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [disabling, setDisabling] = useState(false);

  return (
    <>
      <Card
        title="Two-factor authentication"
        action={
          enabled ? (
            <Badge color="var(--status-completed)">On</Badge>
          ) : (
            <Badge color="var(--brand-gray)">Off</Badge>
          )
        }
      >
        {enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--brand-text)]">
              Enabled since {formatDate(enabledAt)}.
            </p>

            {recoveryCodesLeft <= LOW_CODES ? (
              <CalmStrip
                message={
                  recoveryCodesLeft === 0
                    ? "You have no recovery codes left. Generate new ones so you can still get in if you lose your phone."
                    : `You have ${recoveryCodesLeft} recovery ${
                        recoveryCodesLeft === 1 ? "code" : "codes"
                      } left. Generate new ones so you can still get in if you lose your phone.`
                }
              />
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setRegenerating(true)}>
                Generate new recovery codes
              </Button>
              <Button variant="danger" onClick={() => setDisabling(true)}>
                Turn off two-factor
              </Button>
            </div>
            <p className="text-xs text-[var(--brand-gray)]">
              Replaces your old codes — they stop working right away.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--brand-text)]">
              Add a second step to signing in, using a code from an app on your phone. It means
              someone who learns your password still can&rsquo;t get in.
            </p>
            <Button onClick={() => setEnrolling(true)}>Turn on two-factor</Button>
          </div>
        )}
      </Card>

      {enrolling ? <TwoFactorEnrollModal onClose={() => setEnrolling(false)} /> : null}
      {regenerating ? <RegenerateCodesModal onClose={() => setRegenerating(false)} /> : null}
      {disabling ? <DisableTwoFactorModal onClose={() => setDisabling(false)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Turning it on                                                       */
/* ------------------------------------------------------------------ */

/** The base32 key in four-character blocks, which is the only way anybody types one correctly. */
function groupKey(key: string): string {
  return (key.match(/.{1,4}/g) ?? [key]).join(" ");
}

function TwoFactorEnrollModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { show } = useToast();
  const start = useAction();
  const confirm = useAction();

  const [setup, setSetup] = useState<TwoFactorEnrollmentDTO | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  /** Bumped by Retry. The secret is asked for when the modal opens and on each retry, never else. */
  const [attempt, setAttempt] = useState(0);

  const { run: runStart } = start;
  useEffect(() => {
    runStart(() => beginTwoFactorEnrollment(), {
      failure: "Couldn't set up two-factor. Try again.",
      onSuccess: (data) => setSetup(data),
    });
    // `runStart` is rebuilt whenever the toast context re-renders; asking again on that would mint a
    // fresh secret behind the person's back, so the retry counter is deliberately the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function finish() {
    onClose();
    router.refresh();
    show("Two-factor is on.", "success");
  }

  const showingCodes = codes !== null;

  return (
    <Modal
      open
      size="lg"
      title="Turn on two-factor authentication"
      // While real, one-time codes are on screen the escape hatches — the X, the backdrop and
      // Escape — deliberately do nothing: the line under the codes says what to press instead,
      // rather than throwing away the only copy there will ever be.
      onClose={showingCodes ? () => undefined : onClose}
    >
      {!setup && start.pending ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Spinner size={20} />
          <p className="text-sm text-[var(--brand-text)]">Setting up your two-factor secret…</p>
        </div>
      ) : !setup ? (
        <ErrorBanner
          message={start.error ?? "Couldn't set up two-factor. Try again."}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      ) : (
        <div className="space-y-6">
          {/* Step 1 */}
          {showingCodes ? (
            <p className="text-sm font-semibold text-[var(--status-completed)]">✓ Scanned the code</p>
          ) : (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--brand-ink)]">
                1. Scan this code with your authenticator app
              </h3>
              <p className="text-sm text-[var(--brand-text)]">
                Open an authenticator app such as Google Authenticator or Microsoft Authenticator on
                your phone, then scan this code.
              </p>
              <div className="flex justify-center">
                <span className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={setup.qrDataUri}
                    alt="QR code for your authenticator app"
                    width={180}
                    height={180}
                  />
                </span>
              </div>

              <p className="text-sm text-[var(--brand-text)]">Can&rsquo;t scan it? Enter this key by hand:</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input readOnly value={groupKey(setup.manualKey)} className="font-mono" aria-label="Setup key" />
                <Button
                  variant="secondary"
                  onClick={() => {
                    // The ungrouped key is copied on purpose: every app tolerates it, and not every
                    // password manager strips the spaces the screen adds for readability.
                    void navigator.clipboard?.writeText(setup.manualKey).then(() => setKeyCopied(true));
                  }}
                >
                  {keyCopied ? "Copied" : "Copy"}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(setup.otpauthUrl)
                    .then(() => show("Setup link copied.", "success"));
                }}
                className="text-xs font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
              >
                Copy setup link instead
              </button>
            </section>
          )}

          {/* Step 2 */}
          {showingCodes ? (
            <p className="text-sm font-semibold text-[var(--status-completed)]">✓ Verified</p>
          ) : (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--brand-ink)]">
                2. Enter the code from the app
              </h3>
              <p className="text-sm text-[var(--brand-text)]">
                Enter the current 6-digit code shown in your authenticator app.
              </p>
              <Refusal message={confirm.error} />
              <Field label="Verification code">
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-widest"
                />
              </Field>
              <Button
                loading={confirm.pending}
                onClick={() =>
                  confirm.run(() => confirmTwoFactorEnrollment({ code }), {
                    failure: WRONG_CODE,
                    onSuccess: (data) => setCodes(data.codes),
                  })
                }
              >
                Enable two-factor
              </Button>
            </section>
          )}

          {/* Step 3 */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--brand-ink)]">
              3. Save your recovery codes
            </h3>
            {codes ? (
              <RecoveryCodesReveal
                codes={codes}
                intro="Nice — two-factor is on. These 8 codes are your backup key if you ever lose your phone. Save them somewhere safe (a password manager is perfect) — we can't show them to you again."
                onDone={finish}
              />
            ) : (
              <p className="text-sm text-[var(--brand-gray)]">
                Your recovery codes will appear here once your code is verified.
              </p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* The codes themselves                                                */
/* ------------------------------------------------------------------ */

function RecoveryCodesReveal({
  codes,
  intro,
  onDone,
}: {
  codes: string[];
  intro: string;
  onDone: () => void;
}) {
  const { show } = useToast();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--brand-text)]">{intro}</p>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {codes.map((code, index) => (
          <li key={code}>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code).then(() => setCopiedIndex(index));
              }}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] px-3 py-2 text-left font-mono text-sm text-[var(--brand-ink)] hover:border-[var(--brand-primary)]"
            >
              {copiedIndex === index ? "Copied" : code}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(codes.join("\n"))
              .then(() => show("Codes copied.", "success"));
          }}
        >
          Copy all codes
        </Button>
        <Button onClick={onDone}>I&rsquo;ve saved these codes</Button>
      </div>

      <p className="text-xs text-[var(--brand-gray)]">
        Save your codes first — press &ldquo;I&rsquo;ve saved these codes&rdquo; above when
        you&rsquo;re ready.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fresh recovery codes                                                */
/* ------------------------------------------------------------------ */

function RegenerateCodesModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { show } = useToast();
  const { run, pending, error } = useAction();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [proof, setProof] = useState<Proof>({ kind: "code", value: "" });

  function finish() {
    onClose();
    router.refresh();
    show("New recovery codes generated.", "success");
  }

  return (
    <Modal
      open
      size={codes ? "lg" : "sm"}
      title="Generate new recovery codes?"
      onClose={codes ? () => undefined : onClose}
      footer={
        codes ? undefined : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                run(() => regenerateRecoveryCodes(proofInput(proof)), {
                  failure: "Couldn't generate new codes. Try again.",
                  onSuccess: (data) => setCodes(data.codes),
                })
              }
            >
              {pending ? "Generating…" : "Generate new codes"}
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <RecoveryCodesReveal
          codes={codes}
          intro="Here are your new recovery codes. Save them somewhere safe — your old codes stopped working just now."
          onDone={finish}
        />
      ) : (
        <div className="space-y-3">
          <p>
            Your old recovery codes will stop working right away. New ones will take their place.
          </p>
          <Refusal message={error} />
          <ProofFields proof={proof} onChange={setProof} />
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Turning it off                                                      */
/* ------------------------------------------------------------------ */

function DisableTwoFactorModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [proof, setProof] = useState<Proof>({ kind: "code", value: "" });

  const waiting = isWaitAWhile(error);

  return (
    <Modal
      open
      size="sm"
      title="Turn off two-factor?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {waiting ? null : (
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                run(() => disableTwoFactor(proofInput(proof)), {
                  success: "Two-factor is off.",
                  failure: WRONG_CODE,
                  onSuccess: () => {
                    onClose();
                    router.refresh();
                  },
                })
              }
            >
              {pending ? "Turning off…" : "Turn off two-factor"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p>Enter a current code from your authenticator app to confirm.</p>
        <Refusal message={error} />
        {waiting ? null : <ProofFields proof={proof} onChange={setProof} />}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* The proof field, shared by both modals                              */
/* ------------------------------------------------------------------ */

type Proof = { kind: "code" | "recovery"; value: string };

/** Exactly one of the two ever reaches the server — the schema refuses both at once. */
function proofInput(proof: Proof) {
  return proof.kind === "code" ? { code: proof.value } : { recoveryCode: proof.value };
}

function ProofFields({ proof, onChange }: { proof: Proof; onChange: (next: Proof) => void }) {
  const usingCode = proof.kind === "code";

  return (
    <div className="space-y-2">
      {usingCode ? (
        <Field label="Verification code">
          <Input
            value={proof.value}
            onChange={(event) => onChange({ kind: "code", value: event.target.value })}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            className="text-center font-mono text-lg tracking-widest"
          />
        </Field>
      ) : (
        <Field label="Recovery code">
          <Input
            value={proof.value}
            onChange={(event) => onChange({ kind: "recovery", value: event.target.value })}
            autoComplete="off"
            placeholder="AB3F-9K2L-MN"
            className="font-mono"
          />
        </Field>
      )}

      <button
        type="button"
        onClick={() => onChange({ kind: usingCode ? "recovery" : "code", value: "" })}
        className="text-xs font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
      >
        {usingCode ? "Use a recovery code instead" : "Use your authenticator app instead"}
      </button>
    </div>
  );
}
