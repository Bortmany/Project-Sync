// Admin → Integrations → Microsoft 365, and the file picker it switches on.
//
// The tenant rule, applied here: a connection is only ever looked up by `orgId: actor.orgId`, so
// another company's connection is NOT FOUND rather than forbidden, and no drive id, folder id or
// file id from a browser can reach a connection that is not the actor's own.
//
// The golden rule, untouched: attaching a file from OneDrive or SharePoint creates an ORDINARY
// DocumentVersion through the same validateUpload → storeFile → uploadDocumentVersion path an
// upload takes. Same magic-number check, same 25 MB ceiling, same random filename, same append-only
// revision history. The only trace of where it came from is the revision note.
//
// Tokens: stored encrypted (src/lib/secret-box.ts), refreshed centrally with one refresh in flight
// per company, and never returned, logged or written to an audit row.

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  MICROSOFT_NOT_CONFIGURED,
  MICROSOFT_RECONNECT_NEEDED,
  authorizeUrl,
  isSafeGraphId,
  microsoftConfig,
  signState,
  verifyState,
} from "@/lib/ms-graph";
import { open, seal } from "@/lib/secret-box";
import {
  MAX_UPLOAD_BYTES,
  assertUploadSize,
  safeOriginalName,
  storeFile,
  validateUpload,
} from "@/lib/upload";
import { assertCan } from "@/lib/permissions";
import type {
  AttachMicrosoftFileInput,
  DocumentVersionDTO,
  MicrosoftBrowseInput,
  MicrosoftConnectionDTO,
  MicrosoftDriveDTO,
  MicrosoftListingDTO,
  MicrosoftSearchInput,
  MicrosoftTargetInput,
} from "@/lib/zod-schemas";
import {
  MicrosoftConnectionDTO as ConnectionSchema,
  MicrosoftDriveDTO as DriveSchema,
  MicrosoftListingDTO as ListingSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { assertStorageRoom } from "@/server/services/billing";
import { assertCanUploadTo, uploadDocumentVersion } from "@/server/services/documents";
import {
  GraphUnauthorizedError,
  downloadItemContent,
  exchangeCodeForTokens,
  graphGet,
  refreshTokens,
} from "@/server/services/graph";
import { randomBytes } from "node:crypto";

/** How each stored token is keyed. Changing a purpose string makes old values unreadable. */
const REFRESH_PURPOSE = "microsoft.refresh-token";
const ACCESS_PURPOSE = "microsoft.access-token";

/** A cached access token is only reused while it has this much life left. */
const TOKEN_SAFETY_MARGIN_MS = 120_000;

/** The most rows one listing or search ever asks Microsoft for. */
const PAGE_SIZE = 100;

/** The fields we ask Graph for. Nothing else about a file is ever read. */
const ITEM_SELECT = "id,name,size,lastModifiedDateTime,folder,file";

/* ------------------------------------------------------------------ */
/* Dormancy and health                                                 */
/* ------------------------------------------------------------------ */

/**
 * What /api/health reports. "dormant" until the owner registers the Azure app and sets the two
 * environment variables; then "configured", with a count of how many companies have connected.
 * Numbers only — no company names, no tenant ids, nothing anyone could use.
 */
export async function microsoftHealth(): Promise<{ status: string; connectedOrgs: number }> {
  const status = microsoftConfig() ? "configured" : "dormant";
  if (status === "dormant") return { status, connectedOrgs: 0 };
  try {
    return { status, connectedOrgs: await prisma.microsoftConnection.count() };
  } catch {
    return { status, connectedOrgs: 0 };
  }
}

/** The configured app registration, or a plain refusal. Every route and action starts here. */
function requireConfig() {
  const config = microsoftConfig();
  if (!config) throw new ServiceError(MICROSOFT_NOT_CONFIGURED);
  return config;
}

export function microsoftAvailable(): boolean {
  return microsoftConfig() !== null;
}

/* ------------------------------------------------------------------ */
/* The connection                                                      */
/* ------------------------------------------------------------------ */

/** The actor's OWN company's connection, or nothing. The only lookup in this file. */
async function ownConnection(orgId: string) {
  return prisma.microsoftConnection.findUnique({
    where: { orgId },
    select: {
      id: true,
      orgId: true,
      tenantId: true,
      tenantDomain: true,
      connectedAt: true,
      staleAt: true,
      accessTokenEnc: true,
      accessTokenExpiresAt: true,
      refreshTokenEnc: true,
      connectedBy: { select: { name: true } },
    },
  });
}

/**
 * What the Admin card (and the file picker's "is this switched on?" check) is told. Never a token,
 * never a refresh token, never a client secret — a domain, a name and two dates.
 */
export async function microsoftConnectionFor(actor: ActorContext): Promise<MicrosoftConnectionDTO> {
  const config = microsoftConfig();
  if (!config) {
    return checkDto(
      ConnectionSchema,
      {
        available: false,
        callbackReady: false,
        connected: false,
        tenantDomain: null,
        connectedByName: null,
        connectedAt: null,
        needsReconnect: false,
      },
      "MicrosoftConnectionDTO",
    );
  }

  const row = await ownConnection(actor.orgId);

  return checkDto(
    ConnectionSchema,
    {
      available: true,
      callbackReady: config.redirectUri !== null,
      connected: Boolean(row),
      tenantDomain: row?.tenantDomain ?? null,
      connectedByName: row?.connectedBy?.name ?? null,
      connectedAt: row?.connectedAt ?? null,
      needsReconnect: Boolean(row?.staleAt),
    },
    "MicrosoftConnectionDTO",
  );
}

/**
 * Where "Connect" sends the administrator. The `state` is signed and carries who pressed it and
 * for which company; the callback refuses anything else, which is what stops somebody's browser
 * being walked through a connection they did not start.
 */
export async function startMicrosoftConnect(actor: ActorContext): Promise<string> {
  assertCan(actor, "MANAGE_INTEGRATIONS");
  const config = requireConfig();

  if (!config.redirectUri) {
    throw new ServiceError(
      "Set APP_BASE_URL to this site's address first — Microsoft needs to know where to send people back to.",
    );
  }

  const state = signState({
    userId: actor.userId,
    orgId: actor.orgId,
    ts: Date.now(),
    nonce: randomBytes(12).toString("base64url"),
  });

  return authorizeUrl(config, config.redirectUri, state);
}

/** The other half: the code Microsoft sent back becomes a stored, encrypted connection. */
export async function completeMicrosoftConnect(
  actor: ActorContext,
  input: { code: string; state: string },
): Promise<MicrosoftConnectionDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");
  const config = requireConfig();
  if (!config.redirectUri) {
    throw new ServiceError("Set APP_BASE_URL to this site's address and connect again.");
  }

  const state = verifyState(input.state);
  if (!state || state.userId !== actor.userId || state.orgId !== actor.orgId) {
    // Tampered, expired, or started by somebody else. Nothing is stored and nothing is explained.
    throw new ServiceError("That connection attempt is no longer valid. Start again from this page.");
  }

  const tokens = await exchangeCodeForTokens(config, config.redirectUri, input.code);

  // Microsoft nearly always tells us the tenant. When it does not, "organizations" is the same
  // placeholder the first exchange used and it keeps working for refreshes — a made-up value like
  // "unknown" would give us a connection that quietly dies at the first token expiry.
  const tenantId = tokens.tenantId ?? "organizations";

  const existing = await ownConnection(actor.orgId);

  await prisma.$transaction(async (tx) => {
    const data = {
      tenantId,
      tenantDomain: tokens.tenantDomain,
      connectedById: actor.userId,
      connectedAt: new Date(),
      refreshTokenEnc: seal(REFRESH_PURPOSE, tokens.refreshToken),
      accessTokenEnc: seal(ACCESS_PURPOSE, tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      staleAt: null,
    };

    if (existing) {
      await tx.microsoftConnection.update({ where: { id: existing.id }, data });
    } else {
      await tx.microsoftConnection.create({ data: { orgId: actor.orgId, ...data } });
    }

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "MicrosoftConnection",
      entityId: actor.orgId,
      action: ACTIVITY.MICROSOFT_CONNECTED,
      summary: `${actor.name} connected Microsoft 365${
        tokens.tenantDomain ? ` (${tokens.tenantDomain})` : ""
      }`,
      // Tenant and domain only. No token, no code, no client secret — ever.
      metadata: { tenantId, tenantDomain: tokens.tenantDomain, reconnected: Boolean(existing) },
    });
  });

  return microsoftConnectionFor(actor);
}

/** Removes the connection, tokens and all. The audit rows of it having existed stay for ever. */
export async function disconnectMicrosoft(actor: ActorContext): Promise<{ removed: true }> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const existing = await ownConnection(actor.orgId);
  if (!existing) throw new NotFoundError("There is no Microsoft 365 connection to remove.");

  await prisma.$transaction(async (tx) => {
    await tx.microsoftConnection.delete({ where: { id: existing.id } });
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "MicrosoftConnection",
      entityId: actor.orgId,
      action: ACTIVITY.MICROSOFT_DISCONNECTED,
      summary: `${actor.name} disconnected Microsoft 365`,
      metadata: { tenantId: existing.tenantId, tenantDomain: existing.tenantDomain },
    });
  });

  return { removed: true };
}

/* ------------------------------------------------------------------ */
/* Tokens: one refresh per company at a time                           */
/* ------------------------------------------------------------------ */

/**
 * The refreshes currently in flight, keyed by company. Ten people opening the picker at the same
 * second must not spend ten refresh tokens — Microsoft retires each one as it is used, so racing
 * refreshes are how a working connection breaks itself.
 *
 * Per process, like rate limiting: two instances can still refresh once each, which is safe (both
 * end with a valid token) and documented.
 */
const refreshesInFlight = new Map<string, Promise<string>>();

/** Marks the connection as needing an administrator. Never deletes it — the row explains itself. */
async function markStale(orgId: string): Promise<void> {
  try {
    await prisma.microsoftConnection.updateMany({
      where: { orgId, staleAt: null },
      data: { staleAt: new Date() },
    });
  } catch (error) {
    logger.warn("Could not mark a Microsoft connection as needing reconnection", { orgId, error });
  }
}

async function runRefresh(orgId: string): Promise<string> {
  const config = requireConfig();
  const row = await ownConnection(orgId);
  if (!row) throw new NotFoundError(MICROSOFT_RECONNECT_NEEDED);

  // Rotating SESSION_SECRET makes every stored token unreadable — by design, since that is the
  // emergency action after a leak. It must land as "reconnect", not as a 500 behind a card that
  // still says "Connected".
  let refreshToken: string;
  try {
    refreshToken = open(REFRESH_PURPOSE, row.refreshTokenEnc);
  } catch {
    await markStale(orgId);
    throw new ServiceError(MICROSOFT_RECONNECT_NEEDED);
  }

  let tokens;
  try {
    tokens = await refreshTokens(config, row.tenantId, refreshToken);
  } catch (error) {
    if (error instanceof GraphUnauthorizedError) {
      await markStale(orgId);
      throw new ServiceError(MICROSOFT_RECONNECT_NEEDED);
    }
    throw error;
  }

  // Microsoft issues a NEW refresh token every time and retires the old one, so the fresh one is
  // saved in the same write as the access token it came with.
  await prisma.microsoftConnection.update({
    where: { orgId },
    data: {
      refreshTokenEnc: seal(REFRESH_PURPOSE, tokens.refreshToken),
      accessTokenEnc: seal(ACCESS_PURPOSE, tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      staleAt: null,
    },
  });

  return tokens.accessToken;
}

/** One refresh per company at a time; everybody else waits for the same answer. */
function refreshOnceFor(orgId: string): Promise<string> {
  const existing = refreshesInFlight.get(orgId);
  if (existing) return existing;

  const started = runRefresh(orgId);
  refreshesInFlight.set(orgId, started);
  void started
    .catch(() => undefined)
    .finally(() => {
      if (refreshesInFlight.get(orgId) === started) refreshesInFlight.delete(orgId);
    });
  return started;
}

/** A usable access token for one company: the cached one while it lasts, otherwise a refresh. */
export async function accessTokenForOrg(orgId: string, options: { force?: boolean } = {}): Promise<string> {
  const row = await ownConnection(orgId);
  if (!row) throw new NotFoundError("Microsoft 365 is not connected for your company.");
  if (row.staleAt) throw new ServiceError(MICROSOFT_RECONNECT_NEEDED);

  if (!options.force && row.accessTokenEnc && row.accessTokenExpiresAt) {
    const usableUntil = row.accessTokenExpiresAt.getTime() - TOKEN_SAFETY_MARGIN_MS;
    if (usableUntil > Date.now()) {
      try {
        return open(ACCESS_PURPOSE, row.accessTokenEnc);
      } catch {
        // Unreadable (SESSION_SECRET rotated, say) — fall through and refresh instead.
      }
    }
  }

  return refreshOnceFor(orgId);
}

/**
 * Runs one Graph call for a company. A 401 buys exactly one forced refresh and one retry; if the
 * second attempt is refused too, the connection is marked stale and the person is told to ask an
 * administrator. There is no third attempt and no backoff loop.
 */
async function withGraph<T>(orgId: string, call: (accessToken: string) => Promise<T>): Promise<T> {
  const token = await accessTokenForOrg(orgId);
  try {
    return await call(token);
  } catch (error) {
    if (!(error instanceof GraphUnauthorizedError)) throw error;

    let fresh: string;
    try {
      fresh = await accessTokenForOrg(orgId, { force: true });
    } catch {
      await markStale(orgId);
      throw new ServiceError(MICROSOFT_RECONNECT_NEEDED);
    }

    try {
      return await call(fresh);
    } catch (again) {
      if (again instanceof GraphUnauthorizedError) {
        await markStale(orgId);
        throw new ServiceError(MICROSOFT_RECONNECT_NEEDED);
      }
      throw again;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Browsing (the same permission an upload needs)                      */
/* ------------------------------------------------------------------ */

/**
 * Nobody sees a single file name without passing the check an upload to that exact task would
 * pass. The target comes from the request, is resolved against the actor's own company, and the
 * permission is decided on the target row's organisation — never the actor's assumed one.
 */
async function assertMayBrowse(actor: ActorContext, target: MicrosoftTargetInput): Promise<void> {
  requireConfig();
  await assertCanUploadTo(actor, target);
}

type GraphItemRow = {
  id?: unknown;
  name?: unknown;
  size?: unknown;
  lastModifiedDateTime?: unknown;
  folder?: unknown;
  file?: unknown;
};

function toItemDTO(row: GraphItemRow) {
  const size = typeof row.size === "number" ? row.size : null;
  const modified =
    typeof row.lastModifiedDateTime === "string" ? new Date(row.lastModifiedDateTime) : null;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Untitled"),
    isFolder: Boolean(row.folder),
    sizeBytes: size,
    lastModifiedAt: modified && !Number.isNaN(modified.getTime()) ? modified : null,
    tooLarge: size !== null && size > MAX_UPLOAD_BYTES,
  };
}

/** Folders first, then files, each alphabetically — the order a person expects to read. */
function sortItems(items: ReturnType<typeof toItemDTO>[]) {
  return items.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function usableItems(rows: unknown): ReturnType<typeof toItemDTO>[] {
  const list = Array.isArray(rows) ? (rows as GraphItemRow[]) : [];
  return sortItems(list.map(toItemDTO).filter((item) => isSafeGraphId(item.id)));
}

type GraphList = { value?: unknown; "@odata.nextLink"?: unknown };

/** The places this company's files live: the connected account's own drives. */
export async function listMicrosoftDrives(
  actor: ActorContext,
  input: MicrosoftTargetInput,
): Promise<MicrosoftDriveDTO[]> {
  await assertMayBrowse(actor, input);

  const answer = await withGraph(actor.orgId, (token) =>
    graphGet<GraphList>(token, "/me/drives", { $select: "id,name,driveType", $top: "50" }),
  );

  const rows = Array.isArray(answer.value) ? (answer.value as Record<string, unknown>[]) : [];
  const drives = rows
    .filter((row) => typeof row.id === "string" && isSafeGraphId(row.id))
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? "Files"),
      location: row.driveType === "business" || row.driveType === "personal" ? "OneDrive" : "SharePoint",
    }));

  return checkDtoList(DriveSchema, drives, "MicrosoftDriveDTO");
}

/** One folder's contents — the drive's top level when no folder is named. */
export async function listMicrosoftFolder(
  actor: ActorContext,
  input: MicrosoftBrowseInput,
): Promise<MicrosoftListingDTO> {
  await assertMayBrowse(actor, input);
  const driveId = requireDriveId(input.driveId);

  const path = input.itemId
    ? `/drives/${driveId}/items/${input.itemId}/children`
    : `/drives/${driveId}/root/children`;

  const answer = await withGraph(actor.orgId, (token) =>
    graphGet<GraphList>(token, path, { $select: ITEM_SELECT, $top: String(PAGE_SIZE) }),
  );

  return checkDto(
    ListingSchema,
    {
      driveId,
      driveName: "Files",
      folderId: input.itemId ?? null,
      items: usableItems(answer.value),
      truncated: typeof answer["@odata.nextLink"] === "string",
    },
    "MicrosoftListingDTO",
  );
}

/** Search one drive by file name. */
export async function searchMicrosoftFiles(
  actor: ActorContext,
  input: MicrosoftSearchInput,
): Promise<MicrosoftListingDTO> {
  await assertMayBrowse(actor, input);
  const driveId = requireDriveId(input.driveId);

  // The term goes inside Graph's own search(q='…') function, so a quote in it would change the
  // shape of the call. Quotes are dropped rather than escaped: nobody searches for one.
  const term = input.q.replace(/['"\\]/g, " ").trim();
  if (term.length < 2) throw new ServiceError("Type at least two characters to search.");

  const answer = await withGraph(actor.orgId, (token) =>
    graphGet<GraphList>(token, `/drives/${driveId}/root/search(q='${encodeURIComponent(term)}')`, {
      $select: ITEM_SELECT,
      $top: String(PAGE_SIZE),
    }),
  );

  return checkDto(
    ListingSchema,
    {
      driveId,
      driveName: "Search results",
      folderId: null,
      items: usableItems(answer.value),
      truncated: typeof answer["@odata.nextLink"] === "string",
    },
    "MicrosoftListingDTO",
  );
}

function requireDriveId(driveId: string | undefined): string {
  if (!driveId || !isSafeGraphId(driveId)) {
    throw new NotFoundError("We could not find that OneDrive or SharePoint library.");
  }
  return driveId;
}

/* ------------------------------------------------------------------ */
/* Attaching                                                           */
/* ------------------------------------------------------------------ */

/** The revision note that records where a file came from, kept inside the note field's limit. */
export function attachmentNote(existingNote: string | undefined, fileName: string): string {
  const source = `Attached from OneDrive/SharePoint: ${fileName}`;
  const typed = existingNote?.trim();
  const combined = typed ? `${typed} — ${source}` : source;
  return combined.length > 500 ? `${combined.slice(0, 499)}…` : combined;
}

/**
 * Attaches one file from the company's Microsoft 365. Its bytes come down through our own server
 * and then take the ordinary upload road: size checked before anything is fetched and again on what
 * arrived, magic numbers checked, random filename on disk, one new DocumentVersion.
 */
export async function attachMicrosoftFile(
  actor: ActorContext,
  input: AttachMicrosoftFileInput,
): Promise<DocumentVersionDTO> {
  const { driveId: rawDriveId, itemId, ...meta } = input;
  await assertMayBrowse(actor, meta);
  const driveId = requireDriveId(rawDriveId);

  // Metadata first, so an oversized file is refused before a single byte is pulled — exactly what
  // the upload route does with file.size.
  const item = await withGraph(actor.orgId, (token) =>
    graphGet<GraphItemRow>(token, `/drives/${driveId}/items/${itemId}`, { $select: ITEM_SELECT }),
  );

  if (item.folder) throw new ServiceError("Choose a file, not a folder.");

  const fileName = safeOriginalName(String(item.name ?? "file"));
  const declaredSize = typeof item.size === "number" ? item.size : 0;
  const sizeCheck = assertUploadSize(declaredSize);
  if (!sizeCheck.ok) throw new ServiceError(sizeCheck.error);

  // The plan's storage cap, judged on Microsoft's own declared size and before a byte is fetched or
  // written — the same place the upload route checks it. uploadDocumentVersion() checks it again on
  // what actually arrived; this one is what stops a refused attachment leaving a file on disk that
  // no revision points at.
  await assertStorageRoom(actor, declaredSize);

  const buffer = await withGraph(actor.orgId, (token) =>
    downloadItemContent(token, driveId, itemId, MAX_UPLOAD_BYTES),
  );

  // The bytes decide, never the name Microsoft gave us: a renamed .exe is refused here just as it
  // is when somebody drags one into the upload box.
  const checked = validateUpload(buffer, fileName);
  if (!checked.ok) throw new ServiceError(checked.error);

  const stored = await storeFile(buffer, checked.ext);

  return uploadDocumentVersion(
    actor,
    { ...meta, note: attachmentNote(meta.note, fileName) },
    {
      buffer,
      originalName: fileName,
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    },
  );
}
