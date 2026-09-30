// Test fixtures for "Sign in with Microsoft": a REAL RSA key pair, ID tokens really signed with it,
// and a fake Microsoft behind `global.fetch` that publishes the key and answers the token endpoint.
// Nothing is stubbed out of the validator — every signature in these tests is checked for real.
// No network is ever touched.

import { createSign, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { vi } from "vitest";
import type { Jwk } from "@/lib/ms-id-token";

export const TEST_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
export const TEST_CLIENT_SECRET = "test-client-secret-value";
export const TEST_BASE_URL = "https://tielora.test";

export type TestKey = { kid: string; privateKey: KeyObject; jwk: Jwk };

/** A fresh RSA-2048 key pair, published under `kid`. */
export function makeKey(kid = `kid-${randomUUID()}`): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid, use: "sig", kty: "RSA" };
  return { kid, privateKey, jwk };
}

export const newTenant = (): string => randomUUID();
export const newOid = (): string => randomUUID();

export type ClaimSet = Record<string, unknown>;

/** The claims a genuine Microsoft v2.0 ID token for this person would carry. */
export function claimsFor(options: {
  tid: string;
  oid: string;
  nonce: string;
  email?: string | null;
  edov?: unknown;
  now?: number;
}): ClaimSet {
  const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
  const claims: ClaimSet = {
    aud: TEST_CLIENT_ID,
    iss: `https://login.microsoftonline.com/${options.tid}/v2.0`,
    iat: nowSec,
    nbf: nowSec,
    exp: nowSec + 3600,
    tid: options.tid,
    oid: options.oid,
    nonce: options.nonce,
    name: "Test Person",
    preferred_username: options.email ?? "someone@contoso.example",
    ver: "2.0",
  };
  if (options.email !== undefined && options.email !== null) claims.email = options.email;
  if (options.edov !== undefined) claims.xms_edov = options.edov;
  return claims;
}

/** Signs a claim set as an RS256 JWT with `key`. `header` overrides let a test forge a bad one. */
export function signToken(claims: ClaimSet, key: TestKey, header: Record<string, unknown> = {}): string {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid, ...header })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(key.privateKey).toString("base64url")}`;
}

/**
 * A fake Microsoft. `keys` is what the key-set endpoint publishes; `nextIdToken` is what the token
 * endpoint answers with (a function of the code so a test can hand out different tokens).
 */
export type FakeMicrosoft = {
  keys: Jwk[];
  idTokenFor: (code: string) => string | null;
  tokenStatus: number;
  jwksCalls: number;
  tokenCalls: number;
  lastTokenBody: URLSearchParams | null;
  otherCalls: string[];
};

export function installFakeMicrosoft(initialKeys: Jwk[]): FakeMicrosoft {
  const fake: FakeMicrosoft = {
    keys: initialKeys,
    idTokenFor: () => null,
    tokenStatus: 200,
    jwksCalls: 0,
    tokenCalls: 0,
    lastTokenBody: null,
    otherCalls: [],
  };

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://login.microsoftonline.com/organizations/discovery/v2.0/keys") {
      fake.jwksCalls += 1;
      return new Response(JSON.stringify({ keys: fake.keys }), { status: 200 });
    }
    if (url === "https://login.microsoftonline.com/organizations/oauth2/v2.0/token") {
      fake.tokenCalls += 1;
      const body = new URLSearchParams(String(init?.body ?? ""));
      fake.lastTokenBody = body;
      const idToken = fake.idTokenFor(body.get("code") ?? "");
      if (fake.tokenStatus !== 200 || !idToken) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ id_token: idToken, access_token: "discarded-access-token", token_type: "Bearer" }),
        { status: 200 },
      );
    }
    fake.otherCalls.push(url);
    return new Response("not found", { status: 404 });
  });

  return fake;
}

/** Sets the environment a configured deployment has. Returns a function that puts it back. */
export function configureMicrosoftEnv(): () => void {
  const saved = {
    id: process.env.MS_GRAPH_CLIENT_ID,
    secret: process.env.MS_GRAPH_CLIENT_SECRET,
    base: process.env.APP_BASE_URL,
  };
  process.env.MS_GRAPH_CLIENT_ID = TEST_CLIENT_ID;
  process.env.MS_GRAPH_CLIENT_SECRET = TEST_CLIENT_SECRET;
  process.env.APP_BASE_URL = TEST_BASE_URL;
  return () => {
    restore("MS_GRAPH_CLIENT_ID", saved.id);
    restore("MS_GRAPH_CLIENT_SECRET", saved.secret);
    restore("APP_BASE_URL", saved.base);
  };
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Clears the three Microsoft variables, as an unregistered deployment has them. */
export function unsetMicrosoftEnv(): void {
  delete process.env.MS_GRAPH_CLIENT_ID;
  delete process.env.MS_GRAPH_CLIENT_SECRET;
}

/* ------------------------------------------------------------------ */
/* A cookie jar standing in for next/headers                           */
/* ------------------------------------------------------------------ */

export type JarEntry = { value: string; options?: Record<string, unknown> };

/**
 * The jar next/headers would give a route, for a `vi.mock("next/headers", ...)` factory. A set with
 * `maxAge: 0` is a deletion, exactly as a browser treats it.
 */
export function cookieJarModule(jar: Map<string, JarEntry>) {
  return {
    cookies: async () => ({
      get: (name: string) => {
        const found = jar.get(name);
        return found ? { name, value: found.value } : undefined;
      },
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        if (options && options.maxAge === 0) jar.delete(name);
        else jar.set(name, { value, options });
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    }),
  };
}
