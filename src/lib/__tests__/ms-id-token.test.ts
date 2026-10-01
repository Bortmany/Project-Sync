// The Microsoft ID-token validator, proved against tokens REALLY signed with a real RSA key.
// Pure: no database, and the key set is handed in (or served by an injected fetcher) — no network.

import { describe, expect, it } from "vitest";
import {
  JWKS_FORCED_REFRESH_GAP_MS,
  JWKS_TTL_MS,
  JwksCache,
  PERSONAL_ACCOUNTS_TENANT,
  looksLikeGuid,
  validateIdToken,
  type Jwk,
} from "@/lib/ms-id-token";
import {
  TEST_CLIENT_ID,
  claimsFor,
  makeKey,
  newOid,
  newTenant,
  signToken,
} from "@/server/__tests__/microsoft-signin-fixtures";

const KEY = makeKey("kid-one");
const OTHER_KEY = makeKey("kid-one"); // same kid, different key — a forger's key
const NONCE = "nonce-abc";

const lookup = (keys: Jwk[]) => async (kid: string) => keys.find((key) => key.kid === kid) ?? null;
const expectFor = { clientId: TEST_CLIENT_ID, nonce: NONCE };

function goodClaims(extra: Record<string, unknown> = {}) {
  const tid = newTenant();
  return { ...claimsFor({ tid, oid: newOid(), nonce: NONCE, email: "Ahmed@Contoso.Example", edov: true }), ...extra };
}

describe("validateIdToken", () => {
  it("accepts a genuine token and returns tid + oid, a lower-cased email and xms_edov", async () => {
    const claims = goodClaims();
    const result = await validateIdToken(signToken(claims, KEY), expectFor, lookup([KEY.jwk]));
    expect(result).toEqual({
      ok: true,
      identity: {
        tid: claims.tid,
        oid: claims.oid,
        email: "ahmed@contoso.example",
        emailDomainVerified: true,
        name: "Test Person",
      },
    });
  });

  it("refuses a bad signature", async () => {
    const token = signToken(goodClaims(), OTHER_KEY);
    expect(await validateIdToken(token, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses a token whose claims were edited after signing", async () => {
    const token = signToken(goodClaims(), KEY);
    const [head, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify(goodClaims({ oid: newOid() }))).toString("base64url");
    const result = await validateIdToken(`${head}.${forged}.${sig}`, expectFor, lookup([KEY.jwk]));
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses alg none and HS256", async () => {
    for (const alg of ["none", "HS256"]) {
      const token = signToken(goodClaims(), KEY, { alg });
      const result = await validateIdToken(token, expectFor, lookup([KEY.jwk]));
      expect(result).toEqual({ ok: false, reason: "unsupported-algorithm" });
    }
  });

  it("refuses the wrong audience", async () => {
    const token = signToken(goodClaims({ aud: "another-app" }), KEY);
    expect(await validateIdToken(token, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "wrong-audience",
    });
  });

  it("refuses the wrong nonce", async () => {
    const token = signToken(goodClaims({ nonce: "somebody-elses-nonce" }), KEY);
    expect(await validateIdToken(token, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "wrong-nonce",
    });
  });

  it("refuses an expired token, and one not valid yet", async () => {
    const past = Math.floor(Date.now() / 1000) - 3 * 3600;
    const expired = signToken(goodClaims({ exp: past }), KEY);
    expect(await validateIdToken(expired, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "expired",
    });

    const future = Math.floor(Date.now() / 1000) + 3600;
    const early = signToken(goodClaims({ nbf: future }), KEY);
    expect(await validateIdToken(early, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "not-yet-valid",
    });
  });

  it("refuses an issuer that does not match the token's OWN tid", async () => {
    const claims = goodClaims();
    const token = signToken(
      { ...claims, iss: `https://login.microsoftonline.com/${newTenant()}/v2.0` },
      KEY,
    );
    expect(await validateIdToken(token, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "wrong-issuer",
    });

    const templated = signToken(
      { ...claims, iss: "https://login.microsoftonline.com/{tenantid}/v2.0" },
      KEY,
    );
    expect(await validateIdToken(templated, expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "wrong-issuer",
    });
  });

  it("refuses a missing oid, a missing tid and a malformed tid", async () => {
    const noOid = goodClaims();
    delete noOid.oid;
    expect(await validateIdToken(signToken(noOid, KEY), expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "missing-oid",
    });

    const noTid = goodClaims();
    delete noTid.tid;
    expect(await validateIdToken(signToken(noTid, KEY), expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "bad-tenant",
    });

    const badTid = goodClaims({ tid: "contoso.onmicrosoft.com", iss: "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0" });
    expect(await validateIdToken(signToken(badTid, KEY), expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "bad-tenant",
    });
  });

  it("refuses Microsoft's personal-account tenant", async () => {
    const claims = goodClaims({
      tid: PERSONAL_ACCOUNTS_TENANT,
      iss: `https://login.microsoftonline.com/${PERSONAL_ACCOUNTS_TENANT}/v2.0`,
    });
    expect(await validateIdToken(signToken(claims, KEY), expectFor, lookup([KEY.jwk]))).toEqual({
      ok: false,
      reason: "personal-account",
    });
  });

  it("reports xms_edov as verified only when it is literally true", async () => {
    for (const edov of [undefined, false, "true", 1]) {
      const claims = goodClaims({ xms_edov: edov });
      const result = await validateIdToken(signToken(claims, KEY), expectFor, lookup([KEY.jwk]));
      expect(result.ok && result.identity.emailDomainVerified).toBe(false);
    }
  });

  it("refuses garbage without throwing", async () => {
    for (const token of ["", "a.b", "a.b.c", "!!.!!.!!", `${"x".repeat(20_000)}`]) {
      const result = await validateIdToken(token, expectFor, lookup([KEY.jwk]));
      expect(result.ok).toBe(false);
    }
  });

  it("refuses an unknown key id", async () => {
    const stranger = makeKey("kid-stranger");
    expect(
      await validateIdToken(signToken(goodClaims(), stranger), expectFor, lookup([KEY.jwk])),
    ).toEqual({ ok: false, reason: "unknown-key" });
  });
});

describe("JwksCache", () => {
  it("fetches once, then serves from memory", async () => {
    let calls = 0;
    const cache = new JwksCache(async () => {
      calls += 1;
      return [KEY.jwk];
    });
    expect(await cache.keyFor("kid-one")).not.toBeNull();
    expect(await cache.keyFor("kid-one")).not.toBeNull();
    expect(calls).toBe(1);
  });

  it("re-fetches exactly once on an unknown kid, and picks up a key Microsoft rolled in", async () => {
    let clock = 1_000_000;
    let published: Jwk[] = [KEY.jwk];
    let calls = 0;
    const cache = new JwksCache(
      async () => {
        calls += 1;
        return published;
      },
      () => clock,
    );

    expect(await cache.keyFor("kid-one")).not.toBeNull();
    expect(calls).toBe(1);

    // An hour later Microsoft has published a new key.
    const rolled = makeKey("kid-two");
    published = [KEY.jwk, rolled.jwk];
    clock += 60 * 60_000;

    expect(await cache.keyFor("kid-two")).toEqual(rolled.jwk);
    expect(calls).toBe(2);

    // A made-up kid straight afterwards does NOT buy another fetch.
    expect(await cache.keyFor("kid-made-up")).toBeNull();
    expect(calls).toBe(2);

    // And once the gap has passed it buys exactly one more, then refuses.
    clock += JWKS_FORCED_REFRESH_GAP_MS + 1;
    expect(await cache.keyFor("kid-made-up")).toBeNull();
    expect(calls).toBe(3);
  });

  it("refreshes a stale set and never wipes working keys on a failed fetch", async () => {
    let clock = 0;
    let fail = false;
    let calls = 0;
    const cache = new JwksCache(
      async () => {
        calls += 1;
        if (fail) throw new Error("down");
        return [KEY.jwk];
      },
      () => clock,
    );
    await cache.keyFor("kid-one");
    fail = true;
    clock += JWKS_TTL_MS + 1;
    expect(await cache.keyFor("kid-one")).not.toBeNull();
    expect(calls).toBe(2);
  });

  it("works end to end with validateIdToken", async () => {
    const cache = new JwksCache(async () => [KEY.jwk]);
    const result = await validateIdToken(signToken(goodClaims(), KEY), expectFor, cache.keyFor);
    expect(result.ok).toBe(true);
  });
});

describe("looksLikeGuid", () => {
  it("knows a tenant id when it sees one", () => {
    expect(looksLikeGuid(newTenant())).toBe(true);
    expect(looksLikeGuid("contoso.com")).toBe(false);
    expect(looksLikeGuid(42)).toBe(false);
  });
});
