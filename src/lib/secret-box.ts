// Encrypting a secret at rest: AES-256-GCM under a key derived from SESSION_SECRET with HKDF.
//
// Used by the Microsoft 365 connection, whose refresh and access tokens are bearer credentials for
// somebody's company files. They are never stored in plain text, never logged and never returned by
// any read — the same rule the chat webhook address follows, one step stronger because these can be
// exchanged for new tokens.
//
// The key is derived per PURPOSE, so a sealed value cannot be moved from one use to another: a
// refresh token sealed for "microsoft.refresh-token" will not open as anything else.
//
// Rotating SESSION_SECRET makes every sealed value unreadable. That is the intended behaviour: it
// signs everyone out (docs/GO-LIVE.md, section 2) and it also forces each company to reconnect
// Microsoft 365, which is exactly what should happen when a signing secret has leaked.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { MIN_SECRET_LENGTH } from "@/lib/boot-guards";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/** Fixed, non-secret salt. HKDF needs one; it does not have to be secret, only stable. */
const SALT = "tielora.secret-box.2026";

// The floor is the one house rule 11 sets for SESSION_SECRET itself, imported from
// src/lib/boot-guards.ts rather than copied: a key derived here is exactly as strong as the secret
// the boot guard lets production start with, and the two can never drift apart by half an edit.
// Below it there is no point pretending — refuse to seal rather than seal weakly.

export class SecretBoxUnavailableError extends Error {
  constructor() {
    super(
      `SESSION_SECRET must be set (${MIN_SECRET_LENGTH}+ characters) before secrets can be stored.`,
    );
    this.name = "SecretBoxUnavailableError";
  }
}

/** True when SESSION_SECRET is present and long enough to derive a key from. */
export function secretBoxAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SESSION_SECRET ?? "").length >= MIN_SECRET_LENGTH;
}

/**
 * A 32-byte key for one named purpose, derived from SESSION_SECRET with HKDF. Exported because the
 * OAuth state signature needs a key from the same root and must not invent its own scheme.
 */
export function deriveKey(purpose: string): Buffer {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) throw new SecretBoxUnavailableError();
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), SALT, purpose, KEY_BYTES));
}

const keyFor = deriveKey;

/**
 * Encrypts a string for storage. The result is `v1.<iv>.<tag>.<ciphertext>`, all base64url — safe
 * for a text column, and self-describing enough to change scheme later without guessing.
 */
export function seal(purpose: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** Decrypts a value produced by seal() with the same purpose. Throws if it was tampered with. */
export function open(purpose: string, sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Stored secret is not readable.");

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const body = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Stored secret is not readable.");
  }

  const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Constant-time compare for signatures produced elsewhere in this file's callers. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
