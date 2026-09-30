// Checking a Microsoft ID token — the proof "Sign in with Microsoft" rests on. No database, no
// network of its own and no dependency: Node's own crypto verifies the RS256 signature.
//
// Every check here is one of the research note's binding technical notes
// (docs/decisions/microsoft-teams-app.md, Part 1), in the order they are made:
//  1. The shape: three base64url parts, header `alg` RS256 with a `kid`.
//  2. The signature, against the key Microsoft publishes under that `kid` (the key set is fetched
//     by the caller and handed in through `KeyLookup`, so this file never opens a connection).
//  3. `aud` is our own client id — a token minted for another app is worthless here.
//  4. `nonce` is the one this attempt sent — a token replayed from another attempt is refused.
//  5. `exp` / `nbf` — with two minutes of clock tolerance, no more.
//  6. `tid` looks like a GUID, and is not Microsoft's personal-account tenant.
//  7. `iss` is exactly `https://login.microsoftonline.com/{tid}/v2.0` using the token's OWN `tid`
//     (the `/organizations/` metadata publishes a templated issuer, so it is rebuilt, not trusted).
//  8. `oid` is present. **Identity is `tid` + `oid`** — the email is returned only for the
//     first-time match, and only the caller decides whether `xms_edov` makes it usable.
//
// A refusal carries a short CATEGORY for the log line and nothing else — never a claim value.

import { createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

/** One key from Microsoft's published key set (JWKS). Only RSA keys are ever used. */
export type Jwk = JsonWebKey & { kid?: string; kty?: string; use?: string };

/** Finds the published key for a `kid`, or null. `JwksCache.keyFor` is the real one. */
export type KeyLookup = (kid: string) => Promise<Jwk | null>;

/** What a valid token says about the person. Identity is the pair `tid` + `oid`. */
export type MicrosoftIdentity = {
  /** The Microsoft tenant (company directory), lower-case GUID. */
  tid: string;
  /** The person's permanent object id inside that tenant. */
  oid: string;
  /** The `email` claim when present, lower-cased and trimmed — otherwise null. */
  email: string | null;
  /** True only when `xms_edov` is literally `true`: Microsoft vouches the email's domain is owned. */
  emailDomainVerified: boolean;
  /** Display only, never matched on. */
  name: string | null;
};

export type IdTokenRefusal =
  | "malformed"
  | "unsupported-algorithm"
  | "unknown-key"
  | "bad-signature"
  | "wrong-audience"
  | "wrong-nonce"
  | "expired"
  | "not-yet-valid"
  | "bad-tenant"
  | "personal-account"
  | "wrong-issuer"
  | "missing-oid";

export type IdTokenResult =
  | { ok: true; identity: MicrosoftIdentity }
  | { ok: false; reason: IdTokenRefusal };

export type IdTokenExpectations = {
  /** Our Azure app's client id — the only acceptable `aud`. */
  clientId: string;
  /** The nonce this sign-in attempt sent to Microsoft. */
  nonce: string;
  /** Milliseconds since the epoch; injectable so the tests can move the clock. */
  now?: number;
};

export const LOGIN_ISSUER_HOST = "login.microsoftonline.com";

/** How far our clock and Microsoft's may disagree before `exp`/`nbf` bite. */
export const CLOCK_TOLERANCE_SEC = 120;

/**
 * Microsoft's own tenant for personal (outlook.com / hotmail) accounts. The `/organizations/`
 * endpoint never issues these, and Tielora is for work accounts only (spec: out of scope), so a
 * token claiming it is refused outright — nobody could ever switch a company on with it.
 */
export const PERSONAL_ACCOUNTS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a string shaped like a Microsoft tenant or object id. */
export function looksLikeGuid(value: unknown): value is string {
  return typeof value === "string" && GUID.test(value);
}

/** The exact issuer a v2.0 token from this tenant must carry. */
export function issuerFor(tid: string): string {
  return `https://${LOGIN_ISSUER_HOST}/${tid}/v2.0`;
}

function decodePart(part: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Validates a Microsoft v2.0 ID token completely, or says (by category only) why not.
 * The key set is consulted through `keys`, which may re-fetch once on an unknown `kid`.
 */
export async function validateIdToken(
  token: string,
  expect: IdTokenExpectations,
  keys: KeyLookup,
): Promise<IdTokenResult> {
  if (typeof token !== "string" || token.length > 16_384) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[2]) return { ok: false, reason: "malformed" };

  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims) return { ok: false, reason: "malformed" };

  // RS256 only. "none", HS256 (which would let a public key be used as an HMAC secret) and
  // everything else are refused before any key is looked at.
  if (header.alg !== "RS256") return { ok: false, reason: "unsupported-algorithm" };
  if (typeof header.kid !== "string" || !header.kid || header.kid.length > 200) {
    return { ok: false, reason: "malformed" };
  }

  const jwk = await keys(header.kid);
  if (!jwk || jwk.kty !== "RSA") return { ok: false, reason: "unknown-key" };

  let signatureOk = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    signatureOk = verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
      publicKey,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, reason: "bad-signature" };

  // Only now, with the signature proved, are the claims worth reading.
  if (typeof claims.aud !== "string" || !sameString(claims.aud, expect.clientId)) {
    return { ok: false, reason: "wrong-audience" };
  }
  if (typeof claims.nonce !== "string" || !sameString(claims.nonce, expect.nonce)) {
    return { ok: false, reason: "wrong-nonce" };
  }

  const nowSec = Math.floor((expect.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || nowSec > claims.exp + CLOCK_TOLERANCE_SEC) {
    return { ok: false, reason: "expired" };
  }
  if (claims.nbf !== undefined) {
    if (typeof claims.nbf !== "number" || nowSec < claims.nbf - CLOCK_TOLERANCE_SEC) {
      return { ok: false, reason: "not-yet-valid" };
    }
  }

  if (!looksLikeGuid(claims.tid)) return { ok: false, reason: "bad-tenant" };
  const tid = claims.tid.toLowerCase();
  if (tid === PERSONAL_ACCOUNTS_TENANT) return { ok: false, reason: "personal-account" };

  // The issuer is rebuilt from the token's OWN tid and compared exactly — case included, since
  // Microsoft issues it lower-case.
  if (typeof claims.iss !== "string" || claims.iss !== issuerFor(claims.tid)) {
    return { ok: false, reason: "wrong-issuer" };
  }

  if (typeof claims.oid !== "string" || !claims.oid.trim() || claims.oid.length > 100) {
    return { ok: false, reason: "missing-oid" };
  }

  const email =
    typeof claims.email === "string" && claims.email.includes("@") && claims.email.length <= 320
      ? claims.email.trim().toLowerCase()
      : null;

  return {
    ok: true,
    identity: {
      tid,
      oid: claims.oid.trim().toLowerCase(),
      email,
      emailDomainVerified: claims.xms_edov === true,
      name: typeof claims.name === "string" ? claims.name.slice(0, 200) : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* The published key set, cached in the process                        */
/* ------------------------------------------------------------------ */

/** How long a fetched key set is trusted before it is fetched again. */
export const JWKS_TTL_MS = 6 * 60 * 60_000;

/**
 * How soon after one fetch an unknown `kid` may force another. Microsoft rolls keys rarely; a flood
 * of tokens with made-up `kid`s must not turn this server into a way of hammering Microsoft.
 */
export const JWKS_FORCED_REFRESH_GAP_MS = 60_000;

/** Keeps only well-formed RSA keys with a kid. Anything else in the answer is ignored. */
export function usableKeys(payload: unknown): Jwk[] {
  const list = (payload as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (key): key is Jwk =>
      Boolean(key) &&
      typeof key === "object" &&
      (key as Jwk).kty === "RSA" &&
      typeof (key as Jwk).kid === "string" &&
      typeof (key as Jwk).n === "string" &&
      typeof (key as Jwk).e === "string",
  );
}

/**
 * Microsoft's signing keys, fetched through the caller's own (host-guarded) fetcher and kept in the
 * process for `JWKS_TTL_MS`. An unknown `kid` buys exactly one early re-fetch — which is how a key
 * Microsoft rolled in an hour ago is picked up — and no more than one per `JWKS_FORCED_REFRESH_GAP_MS`.
 * Concurrent callers share one fetch in flight. Per process, like rate limiting.
 */
export class JwksCache {
  private keys: Jwk[] = [];
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly fetchKeys: () => Promise<Jwk[]>,
    private readonly clock: () => number = Date.now,
  ) {}

  private refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.fetchKeys()
        .then((keys) => {
          // An empty or failed answer never wipes keys that were working.
          if (keys.length > 0) this.keys = keys;
          this.fetchedAt = this.clock();
        })
        .catch(() => {
          this.fetchedAt = this.clock();
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  private find(kid: string): Jwk | null {
    return this.keys.find((key) => key.kid === kid) ?? null;
  }

  /** The key for `kid`, fetching the set when stale and re-fetching once when the kid is new. */
  keyFor = async (kid: string): Promise<Jwk | null> => {
    const now = this.clock();
    if (this.keys.length === 0 || now - this.fetchedAt > JWKS_TTL_MS) {
      await this.refresh();
      return this.find(kid);
    }
    const known = this.find(kid);
    if (known) return known;
    if (now - this.fetchedAt < JWKS_FORCED_REFRESH_GAP_MS) return null;
    await this.refresh();
    return this.find(kid);
  };

  /** Test seam: forget everything. */
  clear(): void {
    this.keys = [];
    this.fetchedAt = 0;
    this.inFlight = null;
  }
}
