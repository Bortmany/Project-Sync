// Who runs this deployment — the address the privacy notice and the terms of use point people at
// when a question is about the operator rather than about their own company.
//
// The pages already send account and data questions to "your workspace administrator", and that
// stays: each company's data belongs to that company. This is the OTHER door — the person who
// operates the service itself — which a privacy notice needs to name. It comes from
// PRIVACY_CONTACT_EMAIL and falls back to the owner's own address, so a deployment that never sets
// the variable still names somebody real rather than nobody.
//
// This module is pure, reads the environment only when asked, and is only ever called from server
// components: the address is public by design (it is printed on a public page), but the variable is
// not shipped to the browser as a NEXT_PUBLIC_ value either.

// The index signature lets `process.env` be passed as-is; the tests pass a plain object.
export type LegalContactEnv = {
  PRIVACY_CONTACT_EMAIL?: string;
  [key: string]: string | undefined;
};

/** Where questions about the operator go when nothing is configured. */
export const DEFAULT_PRIVACY_CONTACT_EMAIL = "naeljam@hotmail.com";

/** The operator's contact address: PRIVACY_CONTACT_EMAIL, trimmed, or the default when it is unset or blank. */
export function privacyContactEmail(env: LegalContactEnv = process.env): string {
  const configured = (env.PRIVACY_CONTACT_EMAIL ?? "").trim();
  return configured.length > 0 ? configured : DEFAULT_PRIVACY_CONTACT_EMAIL;
}
