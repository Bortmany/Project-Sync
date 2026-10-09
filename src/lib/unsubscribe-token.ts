// The one-click unsubscribe token carried by every alert and brief email.
//
// It is a SIGNED value, not an `EmailToken` row (spec decision D3). An unsubscribe link has to keep
// working in an inbox for months and has to be the same in every email of its kind, and an
// `EmailToken` is the opposite on every count: single-use, expiring, retired by the next one of its
// purpose, and unrecoverable from its stored hash. So the token is simply
//
//     <person id>.<kind>.<HMAC-SHA256 signature>
//
// signed with a key derived from SESSION_SECRET for its own purpose (`deriveKey` in
// `src/lib/secret-box.ts`, the same road the OAuth `state` is signed on). No expiry, and nothing is
// stored. The known cost, stated in docs/GO-LIVE.md: rotating SESSION_SECRET stops the links in
// existing inboxes working — the page they land on still points to Your account, which always works.
//
// Pure: no database, no network. Proved by src/lib/__tests__/unsubscribe-token.test.ts.

import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/lib/secret-box";
import { UnsubscribeKindSchema, type UnsubscribeKindName } from "@/lib/zod-schemas";

/** The HKDF purpose. Changing it would kill every unsubscribe link already sent. */
export const UNSUBSCRIBE_KEY_PURPOSE = "email.unsubscribe";

/** Bumped only if the signed text ever changes shape; it is part of what is signed. */
const VERSION = "u1";

/** A person id is a cuid; this is generous and still refuses anything silly before any work. */
const PERSON_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** base64url of a 32-byte SHA-256 HMAC, without padding. */
const SIGNATURE_LENGTH = 43;

/** Stands in for a real signature when the token cannot even be parsed, so a miss costs the same. */
const DUMMY_SIGNATURE = "A".repeat(SIGNATURE_LENGTH);

function sign(personId: string, kind: string): string {
  return createHmac("sha256", deriveKey(UNSUBSCRIBE_KEY_PURPOSE))
    .update(`${VERSION}:${personId}:${kind}`)
    .digest("base64url");
}

/**
 * The token for one person and one kind of email, or null when SESSION_SECRET is not set (in which
 * case no alert or brief email is sent at all — a bulk email never goes out without its way out).
 */
export function unsubscribeToken(personId: string, kind: UnsubscribeKindName): string | null {
  try {
    return `${personId}.${kind}.${sign(personId, kind)}`;
  } catch {
    return null;
  }
}

export type UnsubscribeClaim = { personId: string; kind: UnsubscribeKindName };

/**
 * Who and what a token names, or null for anything that is not a genuine token — tampered, a
 * different kind, the wrong shape, an old single-use link, empty, or signed with another secret.
 *
 * Every path does the same work: one HMAC and one constant-time comparison of equal-length
 * buffers, whether or not the token could be parsed, so the time taken says nothing about why a
 * token missed.
 */
export function verifyUnsubscribeToken(token: string | null | undefined): UnsubscribeClaim | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  const [personId = "", kindRaw = "", signature = ""] = parts;
  const kind = UnsubscribeKindSchema.safeParse(kindRaw);
  const wellFormed =
    parts.length === 3 &&
    PERSON_ID.test(personId) &&
    kind.success &&
    signature.length === SIGNATURE_LENGTH;

  let expected: string;
  try {
    // A malformed token is still signed — over a fixed placeholder — so it costs one HMAC too.
    expected = wellFormed ? sign(personId, kindRaw) : sign("-", "-");
  } catch {
    return null;
  }

  const given = Buffer.from(wellFormed ? signature : DUMMY_SIGNATURE, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  // Both are 43 ASCII characters by construction; the length check is belt and braces, because
  // timingSafeEqual throws on unequal lengths.
  const same = given.length === wanted.length && timingSafeEqual(given, wanted);

  if (!same || !wellFormed || !kind.success) return null;
  return { personId, kind: kind.data };
}
