// Who may create a NEW company at /signup — the owner's switch until the paywall is live.
//
// Three modes, decided from the environment alone:
//   "open"   — anybody may sign a company up (what the product will be once it is selling).
//   "invite" — a company may only be created with one of the codes in SIGNUP_INVITE_CODES.
//   "closed" — nobody may; the page says so and points at sign-in.
//
// The rule, in the safe direction: in production the door is OPEN only when SIGNUPS_OPEN is
// literally "true"; otherwise it is INVITE-ONLY while any usable code exists, and CLOSED when none
// does — a production deploy that forgot both variables lets nobody in, never everybody. In
// development and test the door stays open unless codes are set, so a fresh clone and the existing
// tests behave exactly as before. Nothing here touches invitations to join a company that already
// exists (Admin → Users) — those are a different door and are unchanged.
//
// This module is pure and never logs: a code is a bearer secret, so nothing in here ever puts one
// in a log line, an error message or a health report. Only the MODE is ever reported.

import { createHash, timingSafeEqual } from "node:crypto";

export type SignupMode = "open" | "invite" | "closed";

export type SignupEnv = {
  NODE_ENV?: string;
  SIGNUPS_OPEN?: string;
  SIGNUP_INVITE_CODES?: string;
};

/** A code shorter than this is ignored outright — too short to be worth guessing against. */
export const MIN_INVITE_CODE_LENGTH = 8;

/** What the sign-up route and screen say. One place, so the two can never drift apart. */
export const SIGNUP_INVITE_MESSAGE = "Sign-up is by invitation. Enter a valid invite code.";
export const SIGNUP_CLOSED_MESSAGE = "Sign-up is closed for now.";

/** The usable codes: comma-separated, trimmed, blanks dropped, anything under 8 characters dropped. */
export function inviteCodes(env: SignupEnv = process.env): string[] {
  return (env.SIGNUP_INVITE_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length >= MIN_INVITE_CODE_LENGTH);
}

export function signupMode(env: SignupEnv = process.env): SignupMode {
  if (env.SIGNUPS_OPEN === "true") return "open";
  if (inviteCodes(env).length > 0) return "invite";
  return env.NODE_ENV === "production" ? "closed" : "open";
}

/** Fixed-length digest, so two strings of different lengths still take the same time to compare. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Whether `code` is one of the configured invite codes. Constant time in two ways: every code is
 * compared (no early return on the first match), and each comparison is `timingSafeEqual` over a
 * fixed-length hash, so neither the length of a guess nor how much of it was right leaks anything.
 * A missing or blank code is simply wrong.
 */
export function inviteCodeAccepted(code: string | null | undefined, env: SignupEnv = process.env): boolean {
  const offered = digest((code ?? "").trim());
  let matched = false;
  for (const candidate of inviteCodes(env)) {
    // Bitwise-or on purpose: `||` would short-circuit and stop comparing after the first hit.
    matched = timingSafeEqual(offered, digest(candidate)) || matched;
  }
  return matched;
}

/**
 * The one question the route asks: may this request create a company? `null` means yes; otherwise
 * the plain-English refusal to send back. Open needs nothing; invite needs an accepted code; closed
 * refuses whatever was sent.
 */
export function signupRefusal(code: string | null | undefined, env: SignupEnv = process.env): string | null {
  const mode = signupMode(env);
  if (mode === "open") return null;
  if (mode === "closed") return SIGNUP_CLOSED_MESSAGE;
  return inviteCodeAccepted(code, env) ? null : SIGNUP_INVITE_MESSAGE;
}
