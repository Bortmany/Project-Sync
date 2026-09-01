// Time-based one-time passwords — the six digits an authenticator app shows — written out here
// rather than taken from a dependency.
//
// The whole standard (RFC 6238, on top of RFC 4226) is an HMAC-SHA1 of a counter, one dynamic
// truncation and a modulo: about forty lines, with the official test vectors to prove it. That is
// the same trade `src/lib/zip.ts` made — a small, exactly-specified thing the app needs one of, with
// no supply chain behind it — and it keeps the one piece of cryptography in the sign-in path
// readable in one sitting.
//
// Two rules govern this file:
//  1. **It is pure.** No database, no session, no clock it cannot be handed. Every function takes
//     the moment it should judge, so the tests can stand anywhere in time.
//  2. **It never decides anything.** It says which 30-second step a code belongs to, or nothing at
//     all. Replay ("has this step already been used?"), lockouts and audit rows are the service's
//     business, in `src/server/services/two-factor.ts`.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Six digits, thirty seconds, one step either side — what every authenticator app expects. */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
export const TOTP_WINDOW_STEPS = 1;

/** 20 bytes, which is the SHA-1 block the RFC's own examples use and what the apps assume. */
export const TOTP_SECRET_BYTES = 20;

/** RFC 4648 base32, upper case, no padding — the alphabet every authenticator app reads. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Bytes to base32. Padding is deliberately left off: a key is typed or pasted into an app, and
 * every one of them ignores `=` anyway, so the shorter string is the kinder one to read aloud.
 */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return out;
}

/**
 * Base32 back to bytes. Forgiving about the things a person's fingers do — spaces, hyphens, lower
 * case and trailing `=` are all fine — and strict about everything else, because a character that
 * is not in the alphabet is a mistake rather than a secret.
 */
export function base32Decode(text: string): Buffer {
  const cleaned = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("That is not a valid key.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/** A fresh secret for one person's authenticator app. */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** Which 30-second step a moment falls in. Step 0 began at the Unix epoch, as the RFC says. */
export function stepAt(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The counter as the eight big-endian bytes HMAC is taken over. */
function counterBytes(step: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(step));
  return buffer;
}

/**
 * The code for one step: HMAC-SHA1, RFC 4226's dynamic truncation, then the last six digits,
 * zero-padded — "004512" is a real code and must never be shown or compared as "4512".
 */
export function totpCode(secret: Buffer, step: number, digits: number = TOTP_DIGITS): string {
  const digest = createHmac("sha1", secret).update(counterBytes(step)).digest();

  // The low four bits of the last byte say where to read the four-byte window from.
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(truncated % 10 ** digits).padStart(digits, "0");
}

/** Constant-time compare of two codes of the same length. Length differences answer false at once. */
function codesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export type VerifyTotpOptions = {
  /** The moment to judge against. Always passed in, so a test can stand anywhere in time. */
  at?: number;
  /** How many steps either side of now are accepted. One step is 30 seconds of clock drift. */
  window?: number;
  /**
   * The newest step this account has already spent. Anything at or below it is refused however
   * good the digits are — the same six digits are valid for thirty seconds, and a code somebody
   * read over a shoulder must not work twice.
   */
  afterStep?: number | null;
};

/**
 * Checks a typed code. Returns the STEP it matched — which the caller stores as the new
 * `totpLastUsedStep` — or null.
 *
 * Only the shape of the input is judged here; nothing is logged, nothing is decided. A code with
 * spaces in it (people type "123 456") is tidied first.
 */
export function verifyTotpCode(
  secret: Buffer,
  code: string,
  options: VerifyTotpOptions = {},
): number | null {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d+$/.test(cleaned) || cleaned.length !== TOTP_DIGITS) return null;

  const window = options.window ?? TOTP_WINDOW_STEPS;
  const current = stepAt(options.at ?? Date.now());
  const floor = options.afterStep ?? null;

  for (let step = current - window; step <= current + window; step += 1) {
    if (floor !== null && step <= floor) continue;
    if (codesMatch(totpCode(secret, step), cleaned)) return step;
  }

  return null;
}

/**
 * The `otpauth://` address an authenticator app reads out of a QR code.
 *
 * The label carries the issuer as well as the account, which is what makes the app's list say
 * "Tielora (someone@example.com)" rather than an address on its own.
 */
export function otpauthUrl(options: {
  /** The base32 key, exactly as the manual-entry box shows it. */
  secret: string;
  /** Who the account belongs to — their email address. */
  accountName: string;
  /** The product name. */
  issuer: string;
}): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.accountName)}`;
  const query = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
