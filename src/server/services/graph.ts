// Talking to Microsoft: the only file in the app that opens a connection to Microsoft's servers.
//
// Four rules govern it, and they are the reason everything funnels through `microsoftFetch`:
//  1. **Two hosts, ever** — graph.microsoft.com and login.microsoftonline.com. A file id that
//     arrived from a browser can never send this server anywhere else (`microsoftUrlProblem`).
//  2. **Redirects are never followed automatically.** A file download answers with a 302 to a
//     short-lived Microsoft content host; that address is checked against the documented content
//     hosts by hand before it is fetched, and it is fetched WITHOUT our Authorization header — a
//     bearer token must never travel to an address Microsoft chose for us.
//  3. **Timeouts, and no retry storms.** One attempt per call. The single exception is the one
//     refresh-and-retry a 401 earns, which lives in src/server/services/microsoft.ts.
//  4. **Nothing secret is ever logged, returned or put in an error message** — not a token, not the
//     client secret, not an authorization code, not a download address.

import { logger } from "@/lib/logger";
import {
  MICROSOFT_RECONNECT_NEEDED,
  type MicrosoftConfig,
  graphUrl,
  isAllowedDownloadUrl,
  isSafeGraphId,
  microsoftUrlProblem,
  readIdToken,
  tokenUrl,
} from "@/lib/ms-graph";
import { GRAPH_SCOPES } from "@/lib/ms-graph";
import { ServiceError } from "@/server/errors";

/** How long any one call to Microsoft may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Downloading real bytes is allowed longer than a listing, but still bounded. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Said when Microsoft is reachable but unhappy — never their error body, which we do not control. */
const GRAPH_UNAVAILABLE = "Microsoft did not answer. Try again in a moment.";

/** Thrown when the saved token was refused. The caller refreshes once, then gives up. */
export class GraphUnauthorizedError extends ServiceError {
  constructor(message = MICROSOFT_RECONNECT_NEEDED) {
    super(message);
    this.name = "GraphUnauthorizedError";
  }
}

/** What a token exchange or refresh comes back with. The tokens are plain text ONLY in memory. */
export type TokenSet = {
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
  tenantId: string | null;
  tenantDomain: string | null;
};

/**
 * The one door out. Refuses any address that is not one of the two Microsoft hosts, over https,
 * with no credentials and no port — checked at the moment of use, never only when a URL was built.
 */
async function microsoftFetch(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const problem = microsoftUrlProblem(url);
  if (problem) throw new ServiceError(GRAPH_UNAVAILABLE);

  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      // Microsoft's own endpoints do not redirect us; a redirect here would be a surprise, and a
      // surprise is exactly what should not be followed.
      redirect: "manual",
    });
  } catch {
    throw new ServiceError(GRAPH_UNAVAILABLE);
  }
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  error?: unknown;
};

/** Turns Microsoft's token answer into a TokenSet, or throws in plain English. */
async function readTokenResponse(response: Response): Promise<TokenSet> {
  let payload: TokenResponse;
  try {
    payload = (await response.json()) as TokenResponse;
  } catch {
    throw new ServiceError(GRAPH_UNAVAILABLE);
  }

  if (!response.ok || typeof payload.access_token !== "string") {
    // The error CODE is safe to log ("invalid_grant", "invalid_client"); the description is not
    // shown to anyone and the token fields are never touched.
    logger.warn("Microsoft refused a token request", {
      status: response.status,
      reason: typeof payload.error === "string" ? payload.error : "unknown",
    });
    throw new GraphUnauthorizedError();
  }

  if (typeof payload.refresh_token !== "string") {
    // Without a refresh token the connection would work for an hour and then die quietly.
    throw new ServiceError(
      "Microsoft did not return everything we need. Check that offline_access is one of the app's permissions.",
    );
  }

  const seconds = typeof payload.expires_in === "number" ? payload.expires_in : 3_600;
  const claims = readIdToken(typeof payload.id_token === "string" ? payload.id_token : undefined);

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + seconds * 1_000),
    tenantId: claims.tid,
    tenantDomain: claims.domain,
  };
}

/** The first exchange: the code the administrator came back with, for a usable pair of tokens. */
export async function exchangeCodeForTokens(
  config: MicrosoftConfig,
  redirectUri: string,
  code: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES,
  });

  const response = await microsoftFetch(tokenUrl("organizations"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  return readTokenResponse(response);
}

/**
 * A fresh access token from the saved refresh token.
 *
 * Microsoft issues a NEW refresh token on every use and retires the old one, so the caller must
 * always save what comes back here — reusing a spent one is how a connection dies for good.
 */
export async function refreshTokens(
  config: MicrosoftConfig,
  tenantId: string,
  refreshToken: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  });

  const response = await microsoftFetch(tokenUrl(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  return readTokenResponse(response);
}

/* ------------------------------------------------------------------ */
/* Reading from Graph                                                  */
/* ------------------------------------------------------------------ */

/** One GET against Graph, answered as JSON. 401 is its own error so a refresh can be tried once. */
export async function graphGet<T>(
  accessToken: string,
  path: string,
  query: Record<string, string> = {},
): Promise<T> {
  const response = await microsoftFetch(graphUrl(path, query), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (response.status === 401) throw new GraphUnauthorizedError();
  if (response.status === 404) {
    throw new ServiceError("We could not find that file or folder in Microsoft 365.");
  }
  if (response.status === 429 || response.status === 503) {
    throw new ServiceError("Microsoft is busy right now. Try again in a moment.");
  }
  if (!response.ok) {
    logger.warn("Microsoft Graph refused a read", { status: response.status, path });
    throw new ServiceError(GRAPH_UNAVAILABLE);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ServiceError(GRAPH_UNAVAILABLE);
  }
}

/**
 * The bytes of one file.
 *
 * `/content` answers 302 with a pre-authenticated address on a Microsoft content host. That address
 * is checked before it is used, and fetched with NO Authorization header — it carries its own
 * credential and our bearer token has no business travelling to a host we did not choose.
 *
 * `maxBytes` is the app's own 25 MB upload ceiling, and it is enforced THREE times: from Graph's
 * metadata before this is called, from `Content-Length` if one is offered, and — the only one that
 * really counts — by counting the bytes as they arrive and abandoning the download the moment the
 * running total passes the ceiling. A missing or lying `Content-Length` therefore costs one chunk,
 * not a whole server: nothing is ever buffered whole before it is measured.
 */
export async function downloadItemContent(
  accessToken: string,
  driveId: string,
  itemId: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!isSafeGraphId(driveId) || !isSafeGraphId(itemId)) {
    throw new ServiceError("That file reference is not usable.");
  }

  const response = await microsoftFetch(
    graphUrl(`/drives/${driveId}/items/${itemId}/content`),
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    DOWNLOAD_TIMEOUT_MS,
  );

  if (response.status === 401) throw new GraphUnauthorizedError();

  let contentResponse = response;

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";
    if (!isAllowedDownloadUrl(location)) {
      // Deliberately silent about where it pointed: the address is a credential of its own.
      logger.warn("A Microsoft download redirect went somewhere unexpected", { driveId });
      throw new ServiceError("We could not read that file from Microsoft 365.");
    }

    try {
      contentResponse = await fetch(location, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceError("We could not read that file from Microsoft 365.");
    }
  }

  if (!contentResponse.ok) {
    throw new ServiceError("We could not read that file from Microsoft 365.");
  }
  if (tooLarge(contentResponse.headers.get("content-length"), maxBytes)) {
    throw new ServiceError(sizeMessage(maxBytes));
  }

  const bytes = await readBounded(contentResponse, maxBytes);
  if (bytes.length === 0) throw new ServiceError("That file is empty.");
  return bytes;
}

/**
 * Reads a response body chunk by chunk, keeping a running total, and gives up the moment it passes
 * the ceiling — cancelling the stream so the rest is never pulled down.
 *
 * This is the check that matters. `Content-Length` is a claim made by whoever is sending, and a
 * chunked answer need not make one at all; buffering the whole body first to measure it is how one
 * attach takes the whole server down with it.
 */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body;
  if (!body) return Buffer.alloc(0);

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ServiceError(sizeMessage(maxBytes));
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    // A dropped connection or a timeout part-way through: nothing usable, nothing to explain.
    throw new ServiceError("We could not read that file from Microsoft 365.");
  }

  return Buffer.concat(chunks, total);
}

/**
 * Whether a declared size is already over the ceiling. A missing or unreadable header is NOT
 * "small" — it is simply unknown, and `readBounded` is what settles it.
 */
function tooLarge(header: string | null, maxBytes: number): boolean {
  if (header === null || header.trim() === "") return false;
  const declared = Number(header);
  if (!Number.isFinite(declared)) return false;
  return declared > maxBytes;
}

function sizeMessage(maxBytes: number): string {
  return `That file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`;
}
