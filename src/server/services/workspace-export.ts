// Admin → Data & privacy: a full copy of ONE company's data, as a ZIP an administrator can keep.
//
// The tenant rule, applied here: every query below is filtered through one of the three columns
// that carry an organisation — `User.orgId`, `Discipline.orgId`, `Project.orgId` — so another
// company's rows are not merely hidden, they are never read. `org-isolation.service.test.ts` and
// `exports.service.test.ts` both build two companies and parse the archive to prove it.
//
// Four things are deliberately NOT in the archive, and the README inside it says so:
//  - `User.passwordHash` — an argon2 hash is still a credential, and an export is a file that gets
//    emailed around and left on laptops.
//  - `Session.tokenHash`, every `EmailToken` row, and everything about two-factor sign-in (the
//    sealed `User.totpSecretEnc` and every `TwoFactorRecoveryCode`) — the same reason, one step
//    stronger: these are live keys to somebody's account.
//  - A chat integration's `webhookUrl` and the whole Microsoft connection — a webhook address is a
//    bearer secret and the Microsoft tokens can be exchanged for new credentials, so the export
//    shows exactly what the admin screen shows: scheme and host, and nothing at all.
//  - Personal preference data belonging to one person — favorites and private to-do lists. They
//    are not company work; each person exports their own from Your account.
//
// Nothing about an export is stored in a column of its own (the schema is frozen after Milestone 1
// and this needs no amendment). The audit trail IS the record: an `EXPORT_STARTED` row, then an
// `EXPORT_READY` row, both organisation-level with `projectId: null`, and neither one ever carries
// the download token or where the file was written. The archive is named after the id of its own
// `EXPORT_STARTED` row, which is how the download route finds it again with no path stored anywhere.

import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { assertCan } from "@/lib/permissions";
import { storedFilePath } from "@/lib/upload";
import { ZipLimitError, ZipWriter, ZIP_MAX_BYTES } from "@/lib/zip";
import type { WorkspaceExportStatusDTO, WorkspaceExportStatusName } from "@/lib/zod-schemas";
import { maskWebhookUrl, WorkspaceExportStatusDTO as StatusSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { EMAIL_TOKEN_TTL_MS, issueEmailToken, previewEmailToken } from "@/server/services/email-tokens";

/** One export per company per day. The window the screen counts down to. */
export const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** How long a finished archive stays on disk before the hourly sweep deletes it. */
export const EXPORT_FILE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * How long a build may run before an unfinished one is called failed. A job lives in this process
 * only — a restart loses it — so without this line a lost job would leave the screen saying
 * "preparing…" forever and the once-a-day rule would refuse a retry.
 */
export const EXPORT_STALE_MS = 30 * 60 * 1000;

/** How many rows are read from one table at a time. Small enough that memory never grows with data. */
const BATCH = 500;

const ALREADY_TODAY =
  "You have already asked for a full export today — one at a time keeps things fast for everyone. Please try again tomorrow.";

const NO_LINK = "That download link no longer works. Ask for a new export from Admin → Data & privacy.";

const TOO_BIG =
  "This workspace holds more than one ZIP file can carry (4 GB, or 65,535 files). Please ask for help exporting it in parts.";

const BUILD_FAILED = "Something went wrong preparing your export. Try again.";

/* ------------------------------------------------------------------ */
/* Where the files live                                                */
/* ------------------------------------------------------------------ */

/** Absolute path of the exports folder inside DATA_DIR — beside `uploads`, never inside it. */
export function exportsDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "./data", "exports");
}

/** The archive built for one export. Named after the audit row that recorded the request. */
export function exportFilePath(exportId: string): string {
  return path.join(exportsDir(), `${path.basename(exportId)}.zip`);
}

/* ------------------------------------------------------------------ */
/* The per-process bits (deliberately not stored)                      */
/* ------------------------------------------------------------------ */
//
// Two small maps and one promise, all per process — the same accepted limitation rate limiting
// carries. A restart costs the download LINK (the next status read mints a fresh one for whoever
// is looking) and turns an unfinished job into a failed one, which the screen offers to retry.
// It never costs a record: the audit rows are in the database.

type LiveLink = { rawToken: string; expiresAt: Date };

/**
 * The download links this process has handed out, keyed **per export AND per administrator**.
 *
 * Per administrator matters: an `EmailToken` belongs to the person it was minted for, and it dies
 * with their account. Sharing one cached token between a company's administrators would mean the
 * second one is shown a link minted for the first — and the moment that first administrator is
 * deactivated or deletes their own account, their tokens go with them and every download 404s
 * while the screen still shows a link that looks perfectly good for the rest of the day. Each
 * administrator holding their own costs one small row and removes the whole class of problem.
 */
const links = new Map<string, LiveLink>();

/** The cache key: this export, as seen by this administrator. */
function linkKey(exportId: string, userId: string): string {
  return `${exportId}:${userId}`;
}
const failures = new Map<string, string>();
let inFlight: Promise<void> | null = null;

/**
 * Test seam. The job is fired and forgotten in the app, exactly as a chat webhook is; the tests
 * await this instead of sleeping.
 */
export async function whenExportSettles(): Promise<void> {
  await inFlight;
}

/** Test seam: forget the per-process link cache, so a test can act as a restarted server. */
export function forgetExportLinks(): void {
  links.clear();
  failures.clear();
}

/* ------------------------------------------------------------------ */
/* What state is this company's export in?                             */
/* ------------------------------------------------------------------ */

type CurrentExport = {
  state: WorkspaceExportStatusName;
  exportId: string | null;
  requestedAt: Date | null;
  requestedByName: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  documentCount: number | null;
  error: string | null;
};

const NOTHING: CurrentExport = {
  state: "NONE",
  exportId: null,
  requestedAt: null,
  requestedByName: null,
  sizeBytes: null,
  fileCount: null,
  documentCount: null,
  error: null,
};

function numberFrom(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

/**
 * The state of this company's most recent export, derived from the audit trail and the file on
 * disk. Nothing here is stored: "ready", "working" and "failed" are worked out at read time, the
 * same way OVERDUE and a locked phase are.
 */
async function currentExport(orgId: string, now: Date = new Date()): Promise<CurrentExport> {
  const start = await prisma.activityLog.findFirst({
    where: { entityType: "Organization", entityId: orgId, action: ACTIVITY.EXPORT_STARTED },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, actor: { select: { name: true } } },
  });
  if (!start) return NOTHING;

  const base = {
    exportId: start.id,
    requestedAt: start.createdAt,
    requestedByName: start.actor?.name ?? null,
  };

  const ready = await prisma.activityLog.findFirst({
    where: {
      entityType: "Organization",
      entityId: orgId,
      action: ACTIVITY.EXPORT_READY,
      createdAt: { gte: start.createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });

  if (ready) {
    const onDisk = await stat(exportFilePath(start.id)).catch(() => null);
    // A finished export whose file has been swept (or removed by hand) is simply gone: there is
    // nothing to download and nothing stopping a fresh one being asked for.
    if (!onDisk) return { ...NOTHING, ...base, requestedAt: null };
    return {
      ...base,
      state: "READY",
      sizeBytes: onDisk.size,
      fileCount: numberFrom(ready.metadata, "fileCount"),
      documentCount: numberFrom(ready.metadata, "documentCount"),
      error: null,
    };
  }

  const failed = failures.get(start.id);
  const stale = now.getTime() - start.createdAt.getTime() > EXPORT_STALE_MS;
  if (failed || stale) {
    return {
      ...base,
      state: "FAILED",
      sizeBytes: null,
      fileCount: null,
      documentCount: null,
      error: failed ?? BUILD_FAILED,
    };
  }

  return { ...base, state: "WORKING", sizeBytes: null, fileCount: null, documentCount: null, error: null };
}

/**
 * The raw download token for a ready export.
 *
 * The database only ever holds the token's SHA-256 hash, exactly as it does for an emailed link, so
 * a raw token cannot be read back out of it. The one this process minted is cached in memory; when
 * that is gone — after a restart — a fresh one is minted for whichever administrator is looking,
 * and the link they were shown before stops working. That is the honest trade for storing no
 * secret, and it costs a copied link, never the archive.
 */
async function downloadTokenFor(actor: ActorContext, exportId: string): Promise<LiveLink> {
  const key = linkKey(exportId, actor.userId);
  const cached = links.get(key);
  if (cached && cached.expiresAt.getTime() > Date.now() + 60_000) return cached;

  const issued = await issueEmailToken(actor.userId, "EXPORT", EMAIL_TOKEN_TTL_MS.EXPORT);
  const link: LiveLink = { rawToken: issued.rawToken, expiresAt: issued.expiresAt };
  links.set(key, link);
  return link;
}

/** Where the company's export has got to, and whether a new one may be started. ADMIN only. */
export async function workspaceExportStatus(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<WorkspaceExportStatusDTO> {
  assertCan(actor, "EXPORT_ORG");

  const current = await currentExport(actor.orgId, now);
  const cooldownEnds = current.requestedAt
    ? new Date(current.requestedAt.getTime() + EXPORT_COOLDOWN_MS)
    : null;

  // A failed attempt does not spend the day's export: the screen offers "try again", so the rule
  // has to mean "one export that worked", not "one press of the button".
  const inCooldown =
    current.state !== "FAILED" && Boolean(cooldownEnds) && now.getTime() < cooldownEnds!.getTime();
  const canStart = current.state !== "WORKING" && !inCooldown;

  let downloadUrl: string | null = null;
  let linkExpiresAt: Date | null = null;
  if (current.state === "READY" && current.exportId) {
    const link = await downloadTokenFor(actor, current.exportId);
    downloadUrl = `/api/admin/export/download?token=${encodeURIComponent(link.rawToken)}`;
    linkExpiresAt = link.expiresAt;
  }

  return checkDto(
    StatusSchema,
    {
      state: current.state,
      requestedAt: current.requestedAt,
      requestedByName: current.requestedByName,
      sizeBytes: current.sizeBytes,
      fileCount: current.fileCount,
      documentCount: current.documentCount,
      downloadUrl,
      linkExpiresAt,
      canStart,
      nextAllowedAt: inCooldown ? cooldownEnds : null,
      error: current.state === "FAILED" ? current.error : null,
    },
    "WorkspaceExportStatusDTO",
  );
}

/* ------------------------------------------------------------------ */
/* Starting one                                                        */
/* ------------------------------------------------------------------ */

/**
 * Asks for a full copy of this company's data.
 *
 * The hard rule is one export per company per 24 hours, and it is enforced HERE rather than by the
 * rate limiter: `src/lib/rate-limit.ts` counts per person per process, and this has to hold for the
 * whole company however many administrators it has and however many times the server restarts. The
 * clock it reads is the last `EXPORT_STARTED` audit row — the record of intent that already exists,
 * rather than a file's timestamp, which the sweep deletes after two days.
 *
 * The build itself is fired and forgotten, exactly as a chat webhook is: nobody waits on a
 * multi-minute job to see their own button change, and a lost job costs one press of the button.
 */
export async function startWorkspaceExport(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<WorkspaceExportStatusDTO> {
  assertCan(actor, "EXPORT_ORG");

  const current = await currentExport(actor.orgId, now);
  if (current.state === "WORKING") {
    throw new ServiceError("Your export is still being prepared. It will appear here when it is ready.");
  }
  if (
    current.state === "READY" &&
    current.requestedAt &&
    now.getTime() - current.requestedAt.getTime() < EXPORT_COOLDOWN_MS
  ) {
    throw new ServiceError(ALREADY_TODAY);
  }

  const exportId = await prisma.$transaction(async (tx) =>
    appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.EXPORT_STARTED,
      summary: `${actor.name} asked for a full copy of the workspace's data`,
      // No token, no path, no file name. What was asked for, by whom, and when.
      metadata: {},
    }),
  );

  failures.delete(exportId);
  inFlight = buildExport(actor, exportId).catch(() => undefined);

  return workspaceExportStatus(actor, now);
}

/** Builds the archive, then hands the administrator a link to it. Never throws. */
async function buildExport(actor: ActorContext, exportId: string): Promise<void> {
  const partPath = `${exportFilePath(exportId)}.part`;
  let zip: ZipWriter | null = null;

  try {
    await mkdir(exportsDir(), { recursive: true });
    await rm(partPath, { force: true });

    const wouldNotFit = await checkItFits(actor.orgId);
    if (wouldNotFit) throw new ServiceError(TOO_BIG);

    zip = new ZipWriter(partPath);
    const summary = await writeArchive(zip, actor.orgId);
    const finished = await zip.finish();
    zip = null;

    await rename(partPath, exportFilePath(exportId));

    const issued = await prisma.$transaction(async (tx) => {
      const token = await issueEmailToken(actor.userId, "EXPORT", EMAIL_TOKEN_TTL_MS.EXPORT, tx);
      await appendActivity(tx, {
        actorId: actor.userId,
        projectId: null,
        entityType: "Organization",
        entityId: actor.orgId,
        action: ACTIVITY.EXPORT_READY,
        summary: `The workspace export ${actor.name} asked for is ready to download`,
        // Sizes and counts only — never the token, never where the file was written.
        metadata: {
          sizeBytes: finished.bytes,
          fileCount: summary.fileCount,
          documentCount: summary.documentCount,
        },
      });
      return token;
    });

    // The administrator who asked gets their link straight away; anybody else's own status read
    // mints theirs, against their own account, the first time they look.
    links.set(linkKey(exportId, actor.userId), { rawToken: issued.rawToken, expiresAt: issued.expiresAt });
    await removeEarlierArchives(actor.orgId, exportId);
  } catch (error) {
    await zip?.abort().catch(() => undefined);
    await rm(partPath, { force: true }).catch(() => undefined);
    // A size ceiling is something the administrator can act on ("export it in parts"), so its
    // wording reaches the screen exactly as a ServiceError's does. `ZipLimitError` is thrown by the
    // writer rather than by a service, which is why it has to be named here as well.
    const tellThem = error instanceof ServiceError || error instanceof ZipLimitError;
    failures.set(exportId, tellThem ? error.message : BUILD_FAILED);
    // The organisation, never the data: an export failure line names no person, task or file.
    logger.error("A workspace export could not be built", { orgId: actor.orgId, error });
  }
}

/** Deletes the archives of this company's earlier exports, so only the newest copy is on disk. */
async function removeEarlierArchives(orgId: string, keepExportId: string): Promise<void> {
  const earlier = await prisma.activityLog.findMany({
    where: {
      entityType: "Organization",
      entityId: orgId,
      action: ACTIVITY.EXPORT_STARTED,
      id: { not: keepExportId },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true },
  });

  for (const row of earlier) {
    await rm(exportFilePath(row.id), { force: true }).catch(() => undefined);
    // Every administrator's link to that older archive, not just one of them.
    for (const key of links.keys()) {
      if (key.startsWith(`${row.id}:`)) links.delete(key);
    }
    failures.delete(row.id);
  }
}

/**
 * Would this company's data fit in one ZIP file? Checked before a byte is written, so an archive
 * that could never be finished is never started. 4 GB and 65,535 entries are the format's own
 * ceilings (see src/lib/zip.ts); this is deliberately plain 32-bit ZIP, not ZIP64.
 */
async function checkItFits(orgId: string): Promise<boolean> {
  const versions = await prisma.documentVersion.aggregate({
    where: { document: { project: { orgId } } },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  const bytes = versions._sum.sizeBytes ?? 0;
  // Leave a comfortable margin for the JSON files and the ZIP's own headers.
  return bytes > ZIP_MAX_BYTES - 256 * 1024 * 1024 || versions._count._all > 60_000;
}

/* ------------------------------------------------------------------ */
/* The archive's contents                                              */
/* ------------------------------------------------------------------ */

type PageReader = (cursor: string | null, take: number) => Promise<{ id: string }[]>;

/** Cursor paging by id: the same shape for every table, and never a full table in memory. */
function page(cursor: string | null, take: number) {
  return {
    take,
    orderBy: { id: "asc" as const },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * One table as a JSON array, yielded a row at a time.
 *
 * These are deliberately NOT the listing helpers in `src/lib/db.ts` (house rule 2): an export is
 * not a listing. It includes soft-deleted rows — a removed project is still part of the record the
 * company is asking for a copy of — and it reads in id-ordered pages so memory never grows with the
 * data. Every `where` below is still anchored to the organisation through `User.orgId`,
 * `Discipline.orgId` or `Project.orgId`, which is the only thing the tenant rule actually asks.
 */
async function* jsonRows(read: PageReader): AsyncGenerator<string> {
  yield "[\n";
  let cursor: string | null = null;
  let first = true;

  for (;;) {
    const rows: { id: string }[] = await read(cursor, BATCH);
    if (rows.length === 0) break;
    for (const row of rows) {
      yield `${first ? "" : ",\n"}${JSON.stringify(row)}`;
      first = false;
    }
    if (rows.length < BATCH) break;
    cursor = rows[rows.length - 1]!.id;
  }

  yield "\n]\n";
}

/** Everything about a person EXCEPT their password hash. Sessions and tokens are absent entirely. */
const USER_FIELDS = {
  id: true,
  orgId: true,
  email: true,
  name: true,
  role: true,
  disciplineId: true,
  jobTitle: true,
  companyName: true,
  accessExpiresAt: true,
  emailVerifiedAt: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function tableReaders(orgId: string): { name: string; read: PageReader }[] {
  const ofOrg = { project: { orgId } };

  return [
    { name: "users.json", read: (cursor, take) => prisma.user.findMany({ where: { orgId }, select: USER_FIELDS, ...page(cursor, take) }) },
    { name: "disciplines.json", read: (cursor, take) => prisma.discipline.findMany({ where: { orgId }, ...page(cursor, take) }) },
    { name: "projects.json", read: (cursor, take) => prisma.project.findMany({ where: { orgId }, ...page(cursor, take) }) },
    { name: "project-phases.json", read: (cursor, take) => prisma.projectPhase.findMany({ where: ofOrg, ...page(cursor, take) }) },
    { name: "project-members.json", read: (cursor, take) => prisma.projectMember.findMany({ where: ofOrg, ...page(cursor, take) }) },
    { name: "project-disciplines.json", read: (cursor, take) => prisma.projectDiscipline.findMany({ where: ofOrg, ...page(cursor, take) }) },
    { name: "main-tasks.json", read: (cursor, take) => prisma.mainTask.findMany({ where: ofOrg, ...page(cursor, take) }) },
    { name: "discipline-tasks.json", read: (cursor, take) => prisma.disciplineTask.findMany({ where: { mainTask: ofOrg }, ...page(cursor, take) }) },
    { name: "task-dependencies.json", read: (cursor, take) => prisma.taskDependency.findMany({ where: { successor: { mainTask: ofOrg } }, ...page(cursor, take) }) },
    { name: "required-documents.json", read: (cursor, take) => prisma.requiredDocument.findMany({ where: { disciplineTask: { mainTask: ofOrg } }, ...page(cursor, take) }) },
    { name: "documents.json", read: (cursor, take) => prisma.document.findMany({ where: ofOrg, ...page(cursor, take) }) },
    { name: "document-versions.json", read: (cursor, take) => prisma.documentVersion.findMany({ where: { document: ofOrg }, ...page(cursor, take) }) },
    {
      name: "comments.json",
      read: (cursor, take) =>
        prisma.comment.findMany({
          where: { OR: [{ mainTask: ofOrg }, { disciplineTask: { mainTask: ofOrg } }] },
          ...page(cursor, take),
        }),
    },
    { name: "posts.json", read: (cursor, take) => prisma.post.findMany({ where: { orgId }, ...page(cursor, take) }) },
    { name: "post-acknowledgements.json", read: (cursor, take) => prisma.postAck.findMany({ where: { post: { orgId } }, ...page(cursor, take) }) },
    { name: "post-dismissals.json", read: (cursor, take) => prisma.postDismissal.findMany({ where: { post: { orgId } }, ...page(cursor, take) }) },
    { name: "notifications.json", read: (cursor, take) => prisma.notification.findMany({ where: { user: { orgId } }, ...page(cursor, take) }) },
    {
      name: "activity-log.json",
      // A row belongs to this company through its project or through the person who did it. No row
      // can carry one company's project and another company's actor, so the OR cannot widen.
      read: (cursor, take) =>
        prisma.activityLog.findMany({
          where: { OR: [{ project: { orgId } }, { actor: { orgId } }] },
          ...page(cursor, take),
        }),
    },
    {
      name: "chat-integrations.json",
      // The saved webhook address is a bearer secret: the export shows exactly what the admin
      // screen shows — scheme and host — and never the address itself.
      read: async (cursor, take) => {
        const rows = await prisma.orgIntegration.findMany({
          where: { orgId },
          select: {
            id: true,
            orgId: true,
            kind: true,
            enabled: true,
            eventToggles: true,
            dailyBriefSentAt: true,
            createdById: true,
            createdAt: true,
            updatedAt: true,
            webhookUrl: true,
          },
          ...page(cursor, take),
        });
        return rows.map(({ webhookUrl, ...rest }) => ({
          ...rest,
          webhookAddress: maskWebhookUrl(webhookUrl),
        }));
      },
    },
  ];
}

const README = (workspace: string, when: Date) =>
  [
    `Tielora — a full copy of the data held for ${workspace}.`,
    `Prepared ${when.toISOString()}.`,
    "",
    "What is in here",
    "  *.json    One file per kind of record: people, disciplines, projects, phases, teams,",
    "            main tasks, discipline tasks, dependencies, required documents, documents and",
    "            every revision's details, comments, announcements and board posts, who",
    "            acknowledged or dismissed them, notifications, the full activity log, and any",
    "            chat channels this workspace has connected.",
    "  files/    Every uploaded file, including every past revision, under the name Tielora",
    "            stored it as. document-versions.json says which file belongs to which document,",
    "            and what it was originally called.",
    "",
    "What is deliberately left out, and why",
    "  - Passwords. Only a scrambled form is ever stored, and even that is a credential.",
    "  - Sign-in sessions and one-time email links, for the same reason, one step stronger.",
    "  - Two-factor secrets and recovery codes. They are stored encrypted or scrambled and they",
    "    are the second half of somebody's sign-in, so they are never copied out of Tielora.",
    "  - The address of a connected Slack or Teams channel, and the Microsoft 365 connection.",
    "    A webhook address is a password for that channel and Microsoft's tokens can be swapped",
    "    for new ones, so this file shows only which service is connected and to which host.",
    "  - Anything private to one person: starred shortcuts and private to-do lists. Those belong",
    "    to the person, not the company — each person can download their own from Your account.",
    "",
    "Removed work is included. Documents, projects and comments that were deleted in Tielora are",
    "kept as a record, marked with the date they were removed.",
    "",
    "This file is a copy of your company's whole record. Please look after it accordingly.",
    "",
  ].join("\n");

type ArchiveSummary = { fileCount: number; documentCount: number };

/** Writes every entry of one company's archive, in order, streaming throughout. */
async function writeArchive(zip: ZipWriter, orgId: string): Promise<ArchiveSummary> {
  const organization = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!organization) throw new NotFoundError("We could not find that workspace.");

  await zip.addBuffer("README.txt", Buffer.from(README(organization.name, new Date()), "utf8"));
  await zip.addBuffer("organization.json", Buffer.from(`${JSON.stringify(organization, null, 2)}\n`, "utf8"));

  for (const table of tableReaders(orgId)) {
    await zip.addStream(table.name, jsonRows(table.read));
  }

  const documentCount = await prisma.document.count({ where: { project: { orgId } } });
  const fileCount = await addUploadedFiles(zip, orgId);
  return { fileCount, documentCount };
}

/** Adds every stored file of this company's document revisions, one at a time, never buffered. */
async function addUploadedFiles(zip: ZipWriter, orgId: string): Promise<number> {
  let cursor: string | null = null;
  let added = 0;
  let missing = 0;

  for (;;) {
    const rows: { id: string; storedFilename: string }[] = await prisma.documentVersion.findMany({
      where: { document: { project: { orgId } } },
      select: { id: true, storedFilename: true },
      ...page(cursor, BATCH),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const absolute = storedFilePath(row.storedFilename);
      const onDisk = await stat(absolute).catch(() => null);
      if (!onDisk) {
        missing += 1;
        continue;
      }
      await zip.addFile(`files/${path.basename(row.storedFilename)}`, absolute);
      added += 1;
    }

    if (rows.length < BATCH) break;
    cursor = rows[rows.length - 1]!.id;
  }

  if (missing > 0) {
    // An integrity problem worth a line, exactly as the document download route logs one — and,
    // as there, the line carries counts and the company, never a file name.
    logger.error("Some stored files were missing while building a workspace export", { orgId, missing });
  }
  return added;
}

/* ------------------------------------------------------------------ */
/* Downloading one                                                     */
/* ------------------------------------------------------------------ */

export type ExportDownload = { absolutePath: string; sizeBytes: number; filename: string };

/**
 * Two keys open this door, not one: the download token AND a signed-in administrator of the company
 * whose data it is. The token alone is a bearer, and a bearer that walks past the tenant rule is
 * exactly what the tenant rule exists to stop — so another company's administrator holding a
 * perfectly valid token is answered "not found", like every other cross-company miss.
 *
 * A GET **consumes nothing**: the token stays valid until it expires, so the same link can fetch a
 * large archive again after a dropped connection. That is deliberate, and it is why the link lives
 * for a day and the file is swept after two.
 */
export async function exportDownload(actor: ActorContext, rawToken: string): Promise<ExportDownload> {
  assertCan(actor, "EXPORT_ORG");

  const holder = await previewEmailToken(rawToken, "EXPORT");
  if (!holder || holder.orgId !== actor.orgId) throw new NotFoundError(NO_LINK);

  const current = await currentExport(actor.orgId);
  if (current.state !== "READY" || !current.exportId) throw new NotFoundError(NO_LINK);

  const absolutePath = exportFilePath(current.exportId);
  const onDisk = await stat(absolutePath).catch(() => null);
  if (!onDisk) throw new NotFoundError(NO_LINK);

  const day = (current.requestedAt ?? new Date()).toISOString().slice(0, 10);
  return {
    absolutePath,
    sizeBytes: onDisk.size,
    filename: `tielora-export-${day}.zip`,
  };
}

/* ------------------------------------------------------------------ */
/* Cleaning up                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deletes export archives older than 48 hours. Called from the hourly sweep, after its transaction,
 * for the same reason the chat copies go there: it touches the disk, not the database, and nothing
 * in the app depends on it having run — a file left behind costs disk, never correctness.
 *
 * Never throws.
 */
export async function sweepExportFiles(now: Date = new Date()): Promise<number> {
  let removed = 0;
  try {
    const dir = exportsDir();
    const names = await readdir(dir).catch(() => [] as string[]);

    for (const name of names) {
      if (!name.endsWith(".zip") && !name.endsWith(".part")) continue;
      const full = path.join(dir, name);
      const onDisk = await stat(full).catch(() => null);
      if (!onDisk) continue;
      if (now.getTime() - onDisk.mtime.getTime() < EXPORT_FILE_TTL_MS) continue;
      await rm(full, { force: true });
      removed += 1;
    }

    if (removed > 0) logger.info("Old workspace exports deleted", { removed });
  } catch (error) {
    logger.error("The export cleanup could not finish", { error });
  }
  return removed;
}
