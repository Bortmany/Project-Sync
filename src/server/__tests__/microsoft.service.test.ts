// Service-level tests for Microsoft 365 file attachments (OneDrive and SharePoint).
//
// What is being proved here:
//  - the connect `state` is signed, and a tampered or borrowed one is refused;
//  - tokens are encrypted in the database — the plain text is never in a column, an audit row or a
//    log line — and still survive a round trip well enough to refresh with;
//  - only one refresh is ever in flight per company, because Microsoft retires a refresh token as
//    it is used;
//  - browsing is scoped to the actor's own company and to the permission an upload would need;
//  - an attached file is an ORDINARY DocumentVersion — with the same 25 MB ceiling and the same
//    magic-number check, so a renamed .exe is refused just as it is from a browser;
//  - a connection Microsoft has stopped accepting says so instead of failing quietly;
//  - with no environment variables the whole feature is invisible, and /api/health says "dormant".
//
// No test here touches the network: global.fetch is replaced in every case that would use it.

import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test uploads go to a throwaway folder, never the development data directory.
process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ForbiddenError } from "@/lib/permissions";

// The connect route reads the session cookie, which only exists inside a real request. The tests
// hand it an actor directly so the route's own refusals can be checked.
const session = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/session")>();
  return { ...actual, currentActor: async () => session.actor };
});

import {
  MICROSOFT_NOT_CONFIGURED,
  isAllowedDownloadUrl,
  microsoftConfig,
  signState,
  verifyState,
} from "@/lib/ms-graph";
import { open, seal } from "@/lib/secret-box";
import { NotFoundError, ServiceError } from "@/server/errors";
import { GET as connectRoute } from "@/app/api/integrations/microsoft/connect/route";
import { GET as statusRoute } from "@/app/api/integrations/microsoft/status/route";
import {
  accessTokenForOrg,
  attachMicrosoftFile,
  attachmentNote,
  completeMicrosoftConnect,
  disconnectMicrosoft,
  listMicrosoftDrives,
  listMicrosoftFolder,
  microsoftAvailable,
  microsoftConnectionFor,
  microsoftHealth,
  searchMicrosoftFiles,
  startMicrosoftConnect,
} from "@/server/services/microsoft";
import { createMainTask } from "@/server/services/tasks";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  type Fixture,
} from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_SECRET = "test-client-secret-value";
const BASE_URL = "https://tielora.test";

const REFRESH_TOKEN = "refresh-token-alpha-SECRET";
const ACCESS_TOKEN = "access-token-alpha-SECRET";

const DRIVE_ID = "b!drive-one";
const ITEM_ID = "01ITEMONE";

let fixture: Fixture;
let mainTaskId: string;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();

  process.env.MS_GRAPH_CLIENT_ID = CLIENT_ID;
  process.env.MS_GRAPH_CLIENT_SECRET = CLIENT_SECRET;
  process.env.APP_BASE_URL = BASE_URL;
  delete process.env.MS_GRAPH_REDIRECT_PATH;

  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Attachment test task",
    description: "Somewhere for attached files to land.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: [],
  });
  mainTaskId = mainTask.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  delete process.env.MS_GRAPH_CLIENT_ID;
  delete process.env.MS_GRAPH_CLIENT_SECRET;
  delete process.env.APP_BASE_URL;
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const target = () => ({ projectId: fixture.projectId, mainTaskId });

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A token answer shaped like Microsoft's, including the id_token the tenant is read from. */
function tokenResponse(
  options: { access?: string; refresh?: string; tid?: string; upn?: string; expiresIn?: number } = {},
) {
  const idToken = `${b64({ alg: "RS256" })}.${b64({
    tid: options.tid ?? "tenant-abc",
    preferred_username: options.upn ?? "admin@contoso.com",
  })}.signature`;

  return new Response(
    JSON.stringify({
      access_token: options.access ?? ACCESS_TOKEN,
      refresh_token: options.refresh ?? REFRESH_TOKEN,
      expires_in: options.expiresIn ?? 3_600,
      id_token: idToken,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Replaces the network. Every test that would reach Microsoft goes through one of these. */
function mockNetwork(handler: Handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return handler(url, init as RequestInit | undefined);
  });
}

/** A company that has already connected, with a valid cached access token. */
async function connectDirectly(
  orgId: string,
  options: { expiresInMs?: number; stale?: boolean; connectedById?: string } = {},
) {
  return prisma.microsoftConnection.create({
    data: {
      orgId,
      tenantId: "tenant-abc",
      tenantDomain: "contoso.com",
      connectedById: options.connectedById ?? fixture.adminActor.userId,
      refreshTokenEnc: seal("microsoft.refresh-token", REFRESH_TOKEN),
      accessTokenEnc: seal("microsoft.access-token", ACCESS_TOKEN),
      accessTokenExpiresAt: new Date(Date.now() + (options.expiresInMs ?? 30 * 60_000)),
      staleAt: options.stale ? new Date() : null,
    },
  });
}

/**
 * A body that never stops and declares no length — the shape a `Content-Length` check cannot catch.
 * It reports how many chunks were actually pulled and whether the reader cancelled it.
 */
function endlessStream(chunkBytes = 1024 * 1024) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      // A safety net for the test itself: if the cap were ever not enforced, fail fast rather than
      // filling this machine's memory.
      if (state.pulled > 200) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2_048, 0x20)]);
const EXE_BYTES = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(512, 0x00)]);

/** Graph metadata for one file. */
function itemMetadata(name = "Site layout.pdf", size = PDF_BYTES.length) {
  return { id: ITEM_ID, name, size, file: { mimeType: "application/pdf" } };
}

/* ------------------------------------------------------------------ */
/* The signed connect state                                            */
/* ------------------------------------------------------------------ */

describe("the connect state", () => {
  it("signs who started the connection and refuses a tampered value", () => {
    const state = signState({
      userId: fixture.adminActor.userId,
      orgId: fixture.orgId,
      ts: Date.now(),
      nonce: "abc123",
    });

    expect(verifyState(state)).toMatchObject({
      userId: fixture.adminActor.userId,
      orgId: fixture.orgId,
    });

    const [payload, signature] = state.split(".");
    expect(verifyState(`${payload}.${signature.slice(0, -2)}xy`)).toBeNull();

    const swapped = Buffer.from(
      JSON.stringify({ userId: "somebody-else", orgId: fixture.orgId, ts: Date.now(), nonce: "x" }),
    ).toString("base64url");
    expect(verifyState(`${swapped}.${signature}`)).toBeNull();
  });

  it("refuses a state older than ten minutes", () => {
    const stale = signState({
      userId: fixture.adminActor.userId,
      orgId: fixture.orgId,
      ts: Date.now() - 11 * 60_000,
      nonce: "old",
    });
    expect(verifyState(stale)).toBeNull();
  });

  it("sends an administrator to Microsoft with that state, and refuses everyone else", async () => {
    const url = await startMicrosoftConnect(fixture.adminActor);
    const parsed = new URL(url);

    expect(parsed.host).toBe("login.microsoftonline.com");
    expect(parsed.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      `${BASE_URL}/api/integrations/microsoft/callback`,
    );
    expect(parsed.searchParams.get("scope")).toContain("offline_access");
    expect(parsed.searchParams.get("scope")).toContain("Files.Read.All");
    expect(verifyState(parsed.searchParams.get("state") ?? "")).toMatchObject({
      orgId: fixture.orgId,
    });
    // The client secret never travels in the browser's address bar.
    expect(url).not.toContain(CLIENT_SECRET);

    await expect(startMicrosoftConnect(fixture.engineerActor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a callback whose state was tampered with, and stores nothing", async () => {
    const spy = mockNetwork(() => tokenResponse());
    const good = signState({
      userId: fixture.adminActor.userId,
      orgId: fixture.orgId,
      ts: Date.now(),
      nonce: "abc",
    });

    await expect(
      completeMicrosoftConnect(fixture.adminActor, { code: "the-code", state: `${good}x` }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.microsoftConnection.count()).toBe(0);
  });

  it("refuses a state signed for somebody else in the same company", async () => {
    const spy = mockNetwork(() => tokenResponse());
    const colleague = await makeUser({
      name: "Second Administrator",
      role: "ADMIN",
      orgId: fixture.orgId,
    });
    const state = signState({
      userId: colleague.id,
      orgId: fixture.orgId,
      ts: Date.now(),
      nonce: "abc",
    });

    await expect(
      completeMicrosoftConnect(fixture.adminActor, { code: "the-code", state }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Connecting, storing and disconnecting                               */
/* ------------------------------------------------------------------ */

describe("connecting", () => {
  async function connectThroughMicrosoft() {
    const state = signState({
      userId: fixture.adminActor.userId,
      orgId: fixture.orgId,
      ts: Date.now(),
      nonce: "abc",
    });
    return completeMicrosoftConnect(fixture.adminActor, { code: "the-code", state });
  }

  it("stores the tokens encrypted, never in plain text, and never in the audit trail", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    mockNetwork(() => tokenResponse());

    const dto = await connectThroughMicrosoft();
    expect(dto.connected).toBe(true);
    expect(dto.tenantDomain).toBe("contoso.com");
    expect(dto.connectedByName).toBe(fixture.adminActor.name);
    // The DTO carries nothing secret at all.
    expect(JSON.stringify(dto)).not.toContain(REFRESH_TOKEN);
    expect(JSON.stringify(dto)).not.toContain(ACCESS_TOKEN);

    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(row.refreshTokenEnc).not.toContain(REFRESH_TOKEN);
    expect(row.accessTokenEnc).not.toContain(ACCESS_TOKEN);
    expect(row.refreshTokenEnc.startsWith("v1.")).toBe(true);
    // …and it is genuinely the same value, not a hash: it round-trips.
    expect(open("microsoft.refresh-token", row.refreshTokenEnc)).toBe(REFRESH_TOKEN);
    expect(row.tenantId).toBe("tenant-abc");

    const audit = await prisma.activityLog.findFirst({
      where: { entityType: "MicrosoftConnection", action: "MICROSOFT_CONNECTED" },
    });
    expect(audit?.summary).toContain("connected Microsoft 365");
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain(REFRESH_TOKEN);
    expect(auditText).not.toContain(ACCESS_TOKEN);
    expect(auditText).not.toContain(CLIENT_SECRET);

    const logged = JSON.stringify([warn.mock.calls, info.mock.calls]);
    expect(logged).not.toContain(REFRESH_TOKEN);
    expect(logged).not.toContain(ACCESS_TOKEN);
  });

  it("is refused for anyone but an administrator, and disconnecting is audited", async () => {
    mockNetwork(() => tokenResponse());
    await connectThroughMicrosoft();

    await expect(disconnectMicrosoft(fixture.engineerActor)).rejects.toBeInstanceOf(ForbiddenError);

    await disconnectMicrosoft(fixture.adminActor);
    expect(await prisma.microsoftConnection.count()).toBe(0);
    expect(
      await prisma.activityLog.count({ where: { action: "MICROSOFT_DISCONNECTED" } }),
    ).toBe(1);
  });

  it("keeps one connection per company, replacing it when an administrator connects again", async () => {
    mockNetwork(() => tokenResponse());
    await connectThroughMicrosoft();
    mockNetwork(() => tokenResponse({ refresh: "refresh-token-beta", upn: "boss@contoso.com" }));
    await connectThroughMicrosoft();

    expect(await prisma.microsoftConnection.count({ where: { orgId: fixture.orgId } })).toBe(1);
    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(open("microsoft.refresh-token", row.refreshTokenEnc)).toBe("refresh-token-beta");
  });
});

/* ------------------------------------------------------------------ */
/* Tokens: refresh, singleflight, staleness                            */
/* ------------------------------------------------------------------ */

describe("tokens", () => {
  it("refreshes once for a company even when several people ask at the same moment", async () => {
    await connectDirectly(fixture.orgId, { expiresInMs: -60_000 });

    let refreshCalls = 0;
    mockNetwork((url) => {
      if (url.includes("/oauth2/v2.0/token")) {
        refreshCalls += 1;
        return tokenResponse({ access: "access-token-fresh", refresh: "refresh-token-next" });
      }
      throw new Error(`unexpected call to ${url}`);
    });

    const [one, two, three] = await Promise.all([
      accessTokenForOrg(fixture.orgId),
      accessTokenForOrg(fixture.orgId),
      accessTokenForOrg(fixture.orgId),
    ]);

    expect(refreshCalls).toBe(1);
    expect([one, two, three]).toEqual([
      "access-token-fresh",
      "access-token-fresh",
      "access-token-fresh",
    ]);

    // Microsoft retires a refresh token as it is used, so the new one must have been saved.
    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(open("microsoft.refresh-token", row.refreshTokenEnc)).toBe("refresh-token-next");
  });

  it("sends the saved refresh token back to Microsoft and nothing else", async () => {
    await connectDirectly(fixture.orgId, { expiresInMs: -60_000 });

    let body = "";
    mockNetwork((url, init) => {
      body = String(init?.body ?? "");
      expect(url.startsWith("https://login.microsoftonline.com/")).toBe(true);
      return tokenResponse({ access: "access-token-fresh" });
    });

    await accessTokenForOrg(fixture.orgId);
    const sent = new URLSearchParams(body);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe(REFRESH_TOKEN);
    expect(sent.get("client_id")).toBe(CLIENT_ID);
  });

  it("marks the connection stale when Microsoft refuses the refresh, and says so in plain English", async () => {
    await connectDirectly(fixture.orgId, { expiresInMs: -60_000 });
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mockNetwork(() => json({ error: "invalid_grant" }, 400));

    await expect(accessTokenForOrg(fixture.orgId)).rejects.toThrow(/needs setting up again/i);

    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(row.staleAt).not.toBeNull();

    const dto = await microsoftConnectionFor(fixture.adminActor);
    expect(dto.needsReconnect).toBe(true);
  });

  it("asks for a reconnection — not a crash — after SESSION_SECRET is rotated", async () => {
    await connectDirectly(fixture.orgId, { expiresInMs: -60_000 });
    const spy = mockNetwork(() => tokenResponse());

    // Rotating the signing secret is the intended emergency action after a leak. Every stored token
    // becomes unreadable, and that must land as "connect it again", not as an unexplained failure
    // behind a card that still says "Connected".
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-completely-different-session-secret-0123456789";
    try {
      await expect(accessTokenForOrg(fixture.orgId)).rejects.toThrow(/needs setting up again/i);
    } finally {
      process.env.SESSION_SECRET = previous;
    }

    // Nothing was sent to Microsoft, and the card now tells the administrator the truth.
    expect(spy).not.toHaveBeenCalled();
    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(row.staleAt).not.toBeNull();
    expect((await microsoftConnectionFor(fixture.adminActor)).needsReconnect).toBe(true);
  });

  it("still refreshes when Microsoft did not name the tenant", async () => {
    // No `tid` claim: the connection falls back to the same "organizations" placeholder the first
    // exchange used, so it keeps working instead of dying at the first expiry.
    mockNetwork(() =>
      json({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3_600,
        // An id_token with no `tid` claim at all.
        id_token: `${b64({ alg: "RS256" })}.${b64({ preferred_username: "admin@contoso.com" })}.sig`,
      }),
    );
    const state = signState({
      userId: fixture.adminActor.userId,
      orgId: fixture.orgId,
      ts: Date.now(),
      nonce: "abc",
    });
    await completeMicrosoftConnect(fixture.adminActor, { code: "the-code", state });

    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(row.tenantId).toBe("organizations");

    await prisma.microsoftConnection.update({
      where: { orgId: fixture.orgId },
      data: { accessTokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    let tokenUrlUsed = "";
    mockNetwork((url) => {
      tokenUrlUsed = url;
      return tokenResponse({ access: "access-token-fresh" });
    });

    expect(await accessTokenForOrg(fixture.orgId)).toBe("access-token-fresh");
    expect(tokenUrlUsed).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
  });

  it("tells a member to ask for a reconnection instead of trying a stale connection", async () => {
    await connectDirectly(fixture.orgId, { stale: true });
    const spy = mockNetwork(() => json({}));

    await expect(listMicrosoftDrives(fixture.adminActor, target())).rejects.toThrow(
      /needs setting up again/i,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Browsing                                                            */
/* ------------------------------------------------------------------ */

describe("browsing", () => {
  it("lists drives, folders and search results through our own server", async () => {
    await connectDirectly(fixture.orgId);

    const calls: string[] = [];
    mockNetwork((url, init) => {
      calls.push(url);
      expect(new URL(url).host).toBe("graph.microsoft.com");
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      if (url.includes("/me/drives")) {
        return json({ value: [{ id: DRIVE_ID, name: "Documents", driveType: "business" }] });
      }
      if (url.includes("search(q=")) {
        return json({ value: [itemMetadata("Found layout.pdf")] });
      }
      return json({
        value: [
          itemMetadata("Big drawing.pdf", 40 * 1024 * 1024),
          { id: "01FOLDER", name: "Drawings", folder: { childCount: 3 } },
        ],
      });
    });

    const drives = await listMicrosoftDrives(fixture.adminActor, target());
    expect(drives).toEqual([{ id: DRIVE_ID, name: "Documents", location: "OneDrive" }]);

    const folder = await listMicrosoftFolder(fixture.adminActor, { ...target(), driveId: DRIVE_ID });
    // Folders first, and a file over the limit is flagged rather than hidden.
    expect(folder.items[0].isFolder).toBe(true);
    expect(folder.items[1].tooLarge).toBe(true);

    const found = await searchMicrosoftFiles(fixture.adminActor, {
      ...target(),
      driveId: DRIVE_ID,
      q: "layout",
    });
    expect(found.items[0].name).toBe("Found layout.pdf");
    expect(calls.every((url) => url.startsWith("https://graph.microsoft.com/v1.0/"))).toBe(true);
  });

  it("refuses somebody who could not upload to that task anyway, before any file name is read", async () => {
    await connectDirectly(fixture.orgId);
    const spy = mockNetwork(() => json({ value: [] }));

    // Priya is in the company but on no project, so she cannot upload here — and therefore cannot
    // see a single OneDrive file name either.
    await expect(
      listMicrosoftDrives(fixture.outsiderActor, target()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never reaches another company's connection", async () => {
    const otherOrg = await makeOrg("Other company");
    const other = await makeProjectFixture(otherOrg.id);
    await connectDirectly(otherOrg.id, { connectedById: other.adminActor.userId });

    const theirTask = await createMainTask(other.adminActor, {
      projectId: other.projectId,
      title: "Their own task",
      description: "In the other company.",
      priority: "MEDIUM",
      deadline: inThirtyDays(),
      disciplineTasks: [],
    });

    const spy = mockNetwork(() => json({ value: [] }));

    // The actor's own company has no connection, and the neighbour's is invisible to them.
    await expect(listMicrosoftDrives(fixture.adminActor, target())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // …and a target inside the other company's project is not found either.
    await expect(
      listMicrosoftDrives(fixture.adminActor, {
        projectId: other.projectId,
        mainTaskId: theirTask.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(spy).not.toHaveBeenCalled();

    const dto = await microsoftConnectionFor(fixture.adminActor);
    expect(dto.connected).toBe(false);
    expect(dto.tenantDomain).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Attaching                                                           */
/* ------------------------------------------------------------------ */

describe("attaching a file", () => {
  it("creates an ordinary revision, and records where it came from in the note", async () => {
    await connectDirectly(fixture.orgId);

    const seen: string[] = [];
    mockNetwork((url, init) => {
      seen.push(url);
      if (url.includes("/content")) {
        // Graph answers /content with a redirect to a short-lived Microsoft content host.
        return new Response(null, {
          status: 302,
          headers: { location: "https://contoso.sharepoint.com/personal/download/abc" },
        });
      }
      if (url.startsWith("https://contoso.sharepoint.com/")) {
        // The pre-authenticated address must never receive our bearer token.
        expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
        return new Response(PDF_BYTES, { status: 200 });
      }
      return json(itemMetadata());
    });

    const version = await attachMicrosoftFile(fixture.adminActor, {
      ...target(),
      driveId: DRIVE_ID,
      itemId: ITEM_ID,
      note: "Issued for review",
    });

    expect(version.revisionNumber).toBe(0);
    expect(version.originalFilename).toBe("Site layout.pdf");
    expect(version.mimeType).toBe("application/pdf");
    expect(version.note).toBe("Issued for review — Attached from OneDrive/SharePoint: Site layout.pdf");

    const stored = await prisma.documentVersion.findUniqueOrThrow({ where: { id: version.id } });
    // Random filename on disk, exactly like any other upload.
    expect(stored.storedFilename).not.toContain("Site layout");
    expect(stored.sizeBytes).toBe(PDF_BYTES.length);

    const audit = await prisma.activityLog.findFirst({ where: { action: "DOCUMENT_UPLOADED" } });
    expect(audit?.summary).toContain("Site layout.pdf");
    expect(seen.some((url) => url.includes("/content"))).toBe(true);
  });

  it("refuses a file over the 25 MB limit before downloading a single byte", async () => {
    await connectDirectly(fixture.orgId);

    let downloads = 0;
    mockNetwork((url) => {
      if (url.includes("/content")) {
        downloads += 1;
        return new Response(PDF_BYTES, { status: 200 });
      }
      return json(itemMetadata("Enormous model.pdf", 30 * 1024 * 1024));
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/larger than the 25 MB limit/);

    expect(downloads).toBe(0);
    expect(await prisma.documentVersion.count()).toBe(0);
  });

  it("refuses a program renamed as a PDF — the bytes decide, not the name Microsoft gave us", async () => {
    await connectDirectly(fixture.orgId);

    mockNetwork((url) => {
      if (url.includes("/content")) return new Response(EXE_BYTES, { status: 200 });
      return json(itemMetadata("Totally a report.pdf", EXE_BYTES.length));
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/cannot accept that file type/i);

    expect(await prisma.documentVersion.count()).toBe(0);
    expect(await prisma.document.count()).toBe(0);
  });

  it("refuses a file whose bytes contradict the name Microsoft gave it", async () => {
    await connectDirectly(fixture.orgId);

    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(256, 0x01),
    ]);

    mockNetwork((url) => {
      if (url.includes("/content")) return new Response(pngBytes, { status: 200 });
      return json(itemMetadata("Definitely a report.pdf", pngBytes.length));
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/named \.pdf but its contents/);

    expect(await prisma.documentVersion.count()).toBe(0);
  });

  it("refuses a download redirected somewhere that is not Microsoft", async () => {
    await connectDirectly(fixture.orgId);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    mockNetwork((url) => {
      if (url.includes("/content")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://files.evil.example/steal" },
        });
      }
      return json(itemMetadata());
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/could not read that file/i);

    expect(isAllowedDownloadUrl("https://files.evil.example/steal")).toBe(false);
    expect(isAllowedDownloadUrl("https://contoso.sharepoint.com/x")).toBe(true);
    expect(isAllowedDownloadUrl("http://contoso.sharepoint.com/x")).toBe(false);
  });

  it("refreshes once and retries when the saved token has just expired", async () => {
    await connectDirectly(fixture.orgId);

    let metadataCalls = 0;
    mockNetwork((url) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return tokenResponse({ access: "access-token-fresh" });
      }
      if (url.includes("/content")) return new Response(PDF_BYTES, { status: 200 });
      metadataCalls += 1;
      // The first read is refused as if the cached token had expired a moment ago.
      return metadataCalls === 1 ? json({ error: {} }, 401) : json(itemMetadata());
    });

    const version = await attachMicrosoftFile(fixture.adminActor, {
      ...target(),
      driveId: DRIVE_ID,
      itemId: ITEM_ID,
    });
    expect(version.revisionNumber).toBe(0);
    expect(metadataCalls).toBe(2);
  });

  it("gives up after one retry and asks for a reconnection", async () => {
    await connectDirectly(fixture.orgId);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    let metadataCalls = 0;
    mockNetwork((url) => {
      if (url.includes("/oauth2/v2.0/token")) return tokenResponse({ access: "still-no-good" });
      metadataCalls += 1;
      return json({ error: {} }, 401);
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/needs setting up again/i);

    expect(metadataCalls).toBe(2);
    const row = await prisma.microsoftConnection.findUniqueOrThrow({
      where: { orgId: fixture.orgId },
    });
    expect(row.staleAt).not.toBeNull();
  });

  it("abandons a download mid-stream when the bytes keep coming, Content-Length or not", async () => {
    await connectDirectly(fixture.orgId);

    // The nastiest shape: metadata claims a small file, the body announces no length at all, and
    // then it just keeps sending. Buffering it whole to measure it is how one attach takes the
    // whole server down, so the running total has to be the thing that stops it.
    const endless = endlessStream();
    mockNetwork((url) => {
      if (url.includes("/content")) return new Response(endless.stream, { status: 200 });
      return json(itemMetadata("Innocent looking.pdf", 2_048));
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/larger than the 25 MB limit/);

    expect(endless.state.cancelled).toBe(true);
    // Stopped a chunk or two past the ceiling, not gigabytes later.
    expect(endless.state.pulled).toBeLessThanOrEqual(28);
    expect(await prisma.documentVersion.count()).toBe(0);
  });

  it("still accepts an honest file that arrives without a Content-Length", async () => {
    await connectDirectly(fixture.orgId);

    mockNetwork((url) => {
      if (url.includes("/content")) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(PDF_BYTES.subarray(0, 512)));
            controller.enqueue(new Uint8Array(PDF_BYTES.subarray(512)));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return json(itemMetadata());
    });

    const version = await attachMicrosoftFile(fixture.adminActor, {
      ...target(),
      driveId: DRIVE_ID,
      itemId: ITEM_ID,
    });
    expect(version.sizeBytes).toBe(PDF_BYTES.length);
  });

  it("refuses a file whose Content-Length is already over the limit", async () => {
    await connectDirectly(fixture.orgId);

    mockNetwork((url) => {
      if (url.includes("/content")) {
        return new Response(PDF_BYTES, {
          status: 200,
          headers: { "content-length": String(30 * 1024 * 1024) },
        });
      }
      return json(itemMetadata("Understated.pdf", 2_048));
    });

    await expect(
      attachMicrosoftFile(fixture.adminActor, {
        ...target(),
        driveId: DRIVE_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/larger than the 25 MB limit/);
  });

  it("keeps the note inside the field's limit", () => {
    const long = "x".repeat(600);
    expect(attachmentNote(long, "Drawing.pdf").length).toBeLessThanOrEqual(500);
    expect(attachmentNote(undefined, "Drawing.pdf")).toBe(
      "Attached from OneDrive/SharePoint: Drawing.pdf",
    );
  });
});

/* ------------------------------------------------------------------ */
/* The connect route's own refusals                                    */
/* ------------------------------------------------------------------ */

describe("the connect route", () => {
  const request = () => new Request("https://tielora.test/api/integrations/microsoft/connect");

  afterEach(() => {
    session.actor = null;
  });

  it("sends an administrator to Microsoft", async () => {
    session.actor = fixture.adminActor;
    const response = await connectRoute(request());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("https://login.microsoftonline.com/");
  });

  it("refuses somebody who may not manage integrations outright, never as a setup problem", async () => {
    session.actor = fixture.engineerActor;
    const response = await connectRoute(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("sends an administrator back to the card when this site's address is not set", async () => {
    delete process.env.APP_BASE_URL;
    session.actor = fixture.adminActor;
    const response = await connectRoute(request());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/admin/integrations?microsoft=setup");
  });

  it("answers a plain 'not set up' while dormant, without looking at the session", async () => {
    delete process.env.MS_GRAPH_CLIENT_ID;
    delete process.env.MS_GRAPH_CLIENT_SECRET;
    session.actor = null;

    const response = await connectRoute(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: MICROSOFT_NOT_CONFIGURED });
  });
});

/* ------------------------------------------------------------------ */
/* Dormancy and health                                                 */
/* ------------------------------------------------------------------ */

describe("dormancy", () => {
  beforeEach(() => {
    delete process.env.MS_GRAPH_CLIENT_ID;
    delete process.env.MS_GRAPH_CLIENT_SECRET;
  });

  it("is invisible with no environment variables set", async () => {
    expect(microsoftConfig()).toBeNull();
    expect(microsoftAvailable()).toBe(false);

    const dto = await microsoftConnectionFor(fixture.adminActor);
    expect(dto.available).toBe(false);
    expect(dto.connected).toBe(false);

    await expect(startMicrosoftConnect(fixture.adminActor)).rejects.toThrow(MICROSOFT_NOT_CONFIGURED);
    await expect(listMicrosoftDrives(fixture.adminActor, target())).rejects.toThrow(
      MICROSOFT_NOT_CONFIGURED,
    );
  });

  it("answers a plain 'not set up' from the routes, without even looking at the session", async () => {
    const response = await statusRoute();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: MICROSOFT_NOT_CONFIGURED });
  });

  it("reports dormant on the health check, and configured once the app is registered", async () => {
    expect(await microsoftHealth()).toEqual({ status: "dormant", connectedOrgs: 0 });

    process.env.MS_GRAPH_CLIENT_ID = CLIENT_ID;
    process.env.MS_GRAPH_CLIENT_SECRET = CLIENT_SECRET;
    expect(await microsoftHealth()).toEqual({ status: "configured", connectedOrgs: 0 });

    await connectDirectly(fixture.orgId);
    expect(await microsoftHealth()).toEqual({ status: "configured", connectedOrgs: 1 });
  });
});
