// Microsoft 365 (OneDrive / SharePoint) — the rules of the road, with no database and no network.
//
// Everything here is pure: which environment variables switch the feature on, which hosts may ever
// be called, how the OAuth `state` value is signed and checked, and which addresses a file download
// may be redirected to. The service in src/server/services/graph.ts does the talking; this file is
// what makes the talking safe, and it is where the tests aim.
//
// THREE RULES:
//  1. **Dormant until configured** (house rule 11). With MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
//     unset there is no card, no tab, no route that answers anything but "not set up".
//  2. **Two hosts, ever.** graph.microsoft.com and login.microsoftonline.com. Every outbound call
//     goes through a checker; a download redirect is checked separately against Microsoft's own
//     content hosts before it is followed.
//  3. **No token, no secret and no code ever appears in a log line, a DTO or an error message.**

import { createHmac } from "node:crypto";
import { deriveKey, safeEqualHex } from "@/lib/secret-box";
import { isSafeGraphId } from "@/lib/zod-schemas";

export { isSafeGraphId };

/** What every route and action says while the owner has not registered the Azure app. */
export const MICROSOFT_NOT_CONFIGURED =
  "Microsoft 365 is not set up on this Tielora. Ask your Tielora administrator to switch it on.";

/** Said to a member when the company's connection has stopped working. */
export const MICROSOFT_RECONNECT_NEEDED =
  "The Microsoft 365 connection needs setting up again. Ask your company administrator to reconnect it in Admin → Integrations.";

export const GRAPH_HOST = "graph.microsoft.com";
export const LOGIN_HOST = "login.microsoftonline.com";
export const GRAPH_ROOT = `https://${GRAPH_HOST}/v1.0`;

/** The scopes the connection asks for — the narrowest set that can browse and read shared files. */
export const GRAPH_SCOPES = "offline_access openid profile https://graph.microsoft.com/Files.Read.All";

/** Where the callback lives unless something in front of the app rewrites it. */
export const DEFAULT_REDIRECT_PATH = "/api/integrations/microsoft/callback";

/** How long a connect attempt may sit half-finished before its state value is refused. */
export const STATE_MAX_AGE_MS = 10 * 60_000;

export type MicrosoftConfig = {
  clientId: string;
  clientSecret: string;
  redirectPath: string;
  /** The full https callback address registered in Azure, or null when APP_BASE_URL is not set. */
  redirectUri: string | null;
};

/** Normalises APP_BASE_URL the same way the chat integration does — https/http, no trailing slash. */
function baseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * The Azure app registration, or null when the owner has not made one. Both halves must be present:
 * a client id with no secret cannot complete anything, so it counts as dormant rather than broken.
 */
export function microsoftConfig(env: NodeJS.ProcessEnv = process.env): MicrosoftConfig | null {
  const clientId = env.MS_GRAPH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.MS_GRAPH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;

  const configuredPath = env.MS_GRAPH_REDIRECT_PATH?.trim() || DEFAULT_REDIRECT_PATH;
  const redirectPath = configuredPath.startsWith("/") ? configuredPath : DEFAULT_REDIRECT_PATH;
  const base = baseUrl(env);

  return {
    clientId,
    clientSecret,
    redirectPath,
    redirectUri: base ? `${base}${redirectPath}` : null,
  };
}

export function isMicrosoftConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return microsoftConfig(env) !== null;
}

/* ------------------------------------------------------------------ */
/* Host rules                                                          */
/* ------------------------------------------------------------------ */

/**
 * The only two addresses the app itself ever calls. Checked on every outbound request, not only
 * when a URL is built, so a path or id that arrived from a browser can never redirect our server
 * somewhere else (the same SSRF guard the chat webhooks carry).
 */
export function microsoftUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That address is not usable.";
  }
  if (url.protocol !== "https:") return "That address is not usable.";
  if (url.username || url.password) return "That address is not usable.";
  if (url.port) return "That address is not usable.";
  const host = url.hostname.toLowerCase();
  if (host !== GRAPH_HOST && host !== LOGIN_HOST) return "That address is not usable.";
  return null;
}

/**
 * Where a file download may be redirected to. Graph answers `/content` with a 302 to a short-lived
 * Microsoft content host, so the redirect is followed by hand and only to these.
 *
 * The research note (docs, section 3c) documents the redirect but not the exact host list, so this
 * is a suffix allowlist drawn from the hosts Microsoft actually serves OneDrive and SharePoint
 * content from. If a real tenant ever downloads from a host outside it, the attach fails safely
 * with "we could not read that file" — add the host here rather than loosening the rule.
 */
const DOWNLOAD_HOST_SUFFIXES = [
  ".sharepoint.com",
  ".sharepoint.us",
  ".sharepoint-df.com",
  ".svc.ms",
  ".1drv.com",
  ".onedrive.com",
  ".live.com",
];

export function isAllowedDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  // `url.port` is empty for the default https port. Anything else is a port Microsoft does not
  // serve content from, so it is refused rather than dialled — the same rule the two API hosts get.
  if (url.port) return false;
  const host = url.hostname.toLowerCase();
  if (host === GRAPH_HOST) return true;
  return DOWNLOAD_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/* ------------------------------------------------------------------ */
/* The signed `state` value                                            */
/* ------------------------------------------------------------------ */

export type ConnectState = {
  /** The person who pressed Connect. The callback refuses anybody else. */
  userId: string;
  /** Their company. The callback refuses a session that has since moved company. */
  orgId: string;
  /** When it was signed, in milliseconds. Ten minutes old is too old. */
  ts: number;
  /** Random, so two connect attempts never produce the same string. */
  nonce: string;
};

const STATE_KEY_PURPOSE = "microsoft.oauth-state";

function signatureFor(payload: string): string {
  return createHmac("sha256", deriveKey(STATE_KEY_PURPOSE)).update(payload).digest("base64url");
}

/**
 * Signs the state that travels to Microsoft and back. It binds the attempt to one signed-in person
 * and one company: a state made in somebody else's browser, or edited on the way, is refused.
 */
export function signState(state: ConnectState): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${signatureFor(payload)}`;
}

/** The state's contents when the signature holds and it is not stale, otherwise null. */
export function verifyState(value: string, now = Date.now()): ConnectState | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!safeEqualHex(signature, signatureFor(payload))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const state = parsed as Partial<ConnectState>;
  if (
    typeof state?.userId !== "string" ||
    typeof state?.orgId !== "string" ||
    typeof state?.nonce !== "string" ||
    typeof state?.ts !== "number"
  ) {
    return null;
  }
  if (now - state.ts > STATE_MAX_AGE_MS || state.ts - now > 60_000) return null;

  return { userId: state.userId, orgId: state.orgId, ts: state.ts, nonce: state.nonce };
}

/* ------------------------------------------------------------------ */
/* URL builders                                                        */
/* ------------------------------------------------------------------ */

/**
 * Where the administrator is sent to sign in and approve. `organizations` is the placeholder for
 * "whichever work tenant they sign in with" — we do not know the customer's tenant id until they
 * come back. `prompt=consent` is deliberate: it shows a Microsoft administrator the "consent on
 * behalf of your organisation" tick, which is what makes the connection usable for the company.
 *
 * No PKCE: the research (section 3a) documents the confidential-client authorization-code flow
 * without it, and this is a server-side app holding a real client secret. The signed state above is
 * the cross-site guard.
 */
export function authorizeUrl(config: MicrosoftConfig, redirectUri: string, state: string): string {
  const url = new URL(`https://${LOGIN_HOST}/organizations/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", GRAPH_SCOPES);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/** The token endpoint for one tenant (or the `organizations` placeholder on first exchange). */
export function tokenUrl(tenant: string): string {
  const safe = /^[a-zA-Z0-9.-]+$/.test(tenant) ? tenant : "organizations";
  return `https://${LOGIN_HOST}/${safe}/oauth2/v2.0/token`;
}

/** A Graph v1.0 address with its query, built here so no caller ever concatenates one by hand. */
export function graphUrl(path: string, query: Record<string, string> = {}): string {
  const url = new URL(`${GRAPH_ROOT}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

/** The domain half of a work account, e.g. "contoso.com". Never the person's address itself. */
export function domainOf(userPrincipalName: string | null | undefined): string | null {
  if (!userPrincipalName) return null;
  const at = userPrincipalName.lastIndexOf("@");
  if (at < 0 || at === userPrincipalName.length - 1) return null;
  return userPrincipalName.slice(at + 1).toLowerCase().slice(0, 100);
}

/**
 * Reads the `tid` (tenant) and `preferred_username` claims out of an id_token.
 *
 * The signature is deliberately not checked: the token came back over TLS from Microsoft's own
 * token endpoint in direct answer to our own request, which is the case OpenID Connect itself
 * (§3.1.3.7) allows to skip validation. Nothing security-critical rests on it either — it only
 * decides which tenant id and domain are shown on the admin card.
 */
export function readIdToken(idToken: string | undefined): { tid: string | null; domain: string | null } {
  if (!idToken) return { tid: null, domain: null };
  const parts = idToken.split(".");
  if (parts.length < 2) return { tid: null, domain: null };
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      tid?: unknown;
      preferred_username?: unknown;
    };
    const tid = typeof claims.tid === "string" ? claims.tid.slice(0, 100) : null;
    const upn = typeof claims.preferred_username === "string" ? claims.preferred_username : null;
    return { tid, domain: domainOf(upn) };
  } catch {
    return { tid: null, domain: null };
  }
}
