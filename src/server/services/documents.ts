// Documents and their revisions — the append-only half of the golden rule.
//
// A DocumentVersion row is written once and never updated or deleted: every upload of the same
// document adds the next revision, and the older revisions (and their files) stay exactly where they
// are. There is no per-revision delete anywhere in the app. A whole document can be soft-deleted by an
// administrator or a project manager, which reopens any checklist item it satisfied — and that is
// refused outright when the discipline task it gates is already complete, because removing the proof
// under a finished gate would quietly make a completed task a lie.

import type { Prisma } from "@/generated/prisma/client";
import { activeDocuments, notDeleted, prisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { safeOriginalName, storedFilePath } from "@/lib/upload";
import type {
  DocumentDTO,
  DocumentVersionDTO,
  PostAttachmentDTO,
  UploadMeta,
} from "@/lib/zod-schemas";
import {
  DocumentDTO as DocumentSchema,
  DocumentVersionDTO as DocumentVersionSchema,
  PostAttachmentDTO as PostAttachmentSchema,
} from "@/lib/zod-schemas";
import { externalTaskScope, isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { notify } from "@/server/services/notify";
import { assertCanViewProject, projectsVisibleTo } from "@/server/services/projects";
import { lockMainTask } from "@/server/services/tasks";

/** The most documents one project listing ever returns in one go. */
const PROJECT_DOCUMENT_CAP = 200;

/** The bytes the route has already checked and written to disk, plus what the database needs about them. */
export type StoredUpload = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  ext: string;
  sizeBytes: number;
  checksumSha256: string;
  storedFilename: string;
};

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

/**
 * Adds a revision. Either the first one of a brand-new document, or the next one of a document that
 * is already there. The caller has validated the bytes with validateUpload() and written them with
 * storeFile() — this function only records them and never rewrites history.
 */
export async function uploadDocumentVersion(
  actor: ActorContext,
  meta: UploadMeta,
  file: StoredUpload,
): Promise<DocumentVersionDTO> {
  const target = await assertCanUploadTo(actor, meta);

  const requiredDocument = await resolveRequiredDocument(meta, target);
  const filename = safeOriginalName(file.originalName);
  const title = meta.title?.trim() || withoutExtension(filename);

  // The unique constraint on (documentId, revisionNumber) is the last word on revision numbers.
  // The row lock below stops two uploads racing for the same number; the retry covers the rest.
  let versionId: string;
  try {
    versionId = await writeVersion({ actor, meta, file, target, requiredDocument, title, filename });
  } catch (error) {
    if (!isRevisionClash(error)) throw error;
    versionId = await writeVersion({ actor, meta, file, target, requiredDocument, title, filename });
  }

  await notifyWatchers(actor, target, filename);

  return buildVersionDTO(versionId);
}

/**
 * Works out where a file is going and refuses anyone who may not put it there. Every upload runs
 * through here, and so does every Microsoft 365 browse and attach — a member is shown a company's
 * OneDrive files only after passing exactly the permission an upload to that same task needs, so
 * "attach from OneDrive" can never reach further than "upload a file" already does.
 */
export async function assertCanUploadTo(actor: ActorContext, meta: UploadMeta): Promise<UploadTarget> {
  const target = await resolveTarget(actor, meta);

  // Shared working documents (main-task level) are revised by everyone contributing to that
  // main task, so an engineer assigned to any of its live discipline tasks counts as an
  // assignee here — that is the whole point of a shared register.
  // A contractor is deliberately left out of that widening: they upload to their own discipline
  // task and nowhere else, so the shared register stays the company's.
  let assigneeCtx = target.assigneeId;
  if (!isExternal(actor) && target.mainTaskId && !target.disciplineTaskId && assigneeCtx === null) {
    const contributes = await prisma.disciplineTask.findFirst({
      where: { mainTaskId: target.mainTaskId, assigneeId: actor.userId, ...notDeleted },
      select: { id: true },
    });
    if (contributes) assigneeCtx = actor.userId;
  }

  assertCan(actor, "UPLOAD_DOCUMENT", {
    projectId: target.projectId,
    orgId: target.orgId,
    disciplineId: target.disciplineId,
    assigneeId: assigneeCtx,
  });

  return target;
}

type WriteVersionInput = {
  actor: ActorContext;
  meta: UploadMeta;
  file: StoredUpload;
  target: UploadTarget;
  requiredDocument: { id: string; name: string } | null;
  title: string;
  filename: string;
};

/** Everything one upload changes, in a single transaction: document, revision, checklist item, audit row. */
async function writeVersion(input: WriteVersionInput): Promise<string> {
  const { actor, meta, file, target, requiredDocument, title, filename } = input;

  return prisma.$transaction(async (tx) => {
    // When the document already exists, locking its row is the FIRST thing this transaction does,
    // so a delete of the same document and this upload can never interleave.
    if (target.documentId) {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${target.documentId} FOR UPDATE`;
    }

    const documentId = target.documentId ?? (await createDocument(tx, actor, target, title, meta));

    // Locks this document's row so two people uploading at the same moment queue up instead of
    // both reading the same "current highest revision".
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`;

    const latest = await tx.documentVersion.findFirst({
      where: { documentId },
      orderBy: { revisionNumber: "desc" },
      select: { revisionNumber: true },
    });
    const revisionNumber = latest ? latest.revisionNumber + 1 : 0;

    const version = await tx.documentVersion.create({
      data: {
        documentId,
        revisionNumber,
        storedFilename: file.storedFilename,
        originalFilename: filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        uploadedById: actor.userId,
        note: meta.note?.trim() || null,
      },
    });

    // The document points at its newest revision; the older ones stay exactly as they were.
    await tx.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } });

    if (requiredDocument) {
      await tx.requiredDocument.update({
        where: { id: requiredDocument.id },
        data: { documentId, satisfiedAt: new Date() },
      });
    }

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: target.projectId,
      entityType: "Document",
      entityId: documentId,
      action: ACTIVITY.DOCUMENT_UPLOADED,
      summary: `${actor.name} uploaded ${filename} — Rev ${revisionNumber}`,
      metadata: {
        documentId,
        versionId: version.id,
        revisionNumber,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        mainTaskId: target.mainTaskId,
        disciplineTaskId: target.disciplineTaskId,
        satisfiedRequirement: requiredDocument ? requiredDocument.name : null,
      },
    });

    return version.id;
  });
}

async function createDocument(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  target: UploadTarget,
  title: string,
  meta: UploadMeta,
): Promise<string> {
  const created = await tx.document.create({
    data: {
      projectId: target.projectId,
      mainTaskId: target.mainTaskId,
      disciplineTaskId: target.disciplineTaskId,
      title,
      category: meta.category?.trim() || null,
      uploadedById: actor.userId,
    },
  });
  return created.id;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Everything attached to a main task: the shared documents on the task itself and the documents on
 * each of its discipline tasks. `disciplineTaskId` on each row lets the page group them.
 */
export async function listDocumentsForMainTask(
  actor: ActorContext,
  mainTaskId: string,
): Promise<DocumentDTO[]> {
  const mainTask = await prisma.mainTask.findFirst({
    where: { id: mainTaskId, ...notDeleted, project: { orgId: actor.orgId } },
    select: { id: true, projectId: true },
  });
  if (!mainTask) throw new NotFoundError("We could not find that task.");
  await assertCanViewProject(actor, mainTask.projectId);

  const subtasks = await prisma.disciplineTask.findMany({
    where: { mainTaskId: mainTask.id, ...notDeleted, ...externalTaskScope(actor) },
    select: { id: true },
  });
  const subtaskIds = new Set(subtasks.map((subtask) => subtask.id));

  // A contractor sees the files on their own discipline tasks and nothing else — not the shared
  // main-task register, not another discipline's drawings.
  const rows = (await activeDocuments(actor.orgId, mainTask.projectId)).filter((row) =>
    isExternal(actor)
      ? row.disciplineTaskId !== null && subtaskIds.has(row.disciplineTaskId)
      : row.mainTaskId === mainTask.id ||
        (row.disciplineTaskId !== null && subtaskIds.has(row.disciplineTaskId)),
  );

  return toDocumentDTOs(rows);
}

/** The documents of one discipline task. */
export async function listDocumentsForDisciplineTask(
  actor: ActorContext,
  disciplineTaskId: string,
): Promise<DocumentDTO[]> {
  const task = await prisma.disciplineTask.findFirst({
    where: {
      id: disciplineTaskId,
      ...notDeleted,
      ...externalTaskScope(actor),
      mainTask: { project: { orgId: actor.orgId } },
    },
    select: { id: true, mainTask: { select: { projectId: true } } },
  });
  if (!task) throw new NotFoundError("We could not find that task.");
  await assertCanViewProject(actor, task.mainTask.projectId);

  const rows = (await activeDocuments(actor.orgId, task.mainTask.projectId)).filter(
    (row) => row.disciplineTaskId === task.id,
  );
  return toDocumentDTOs(rows);
}

/** Every live document on a project, newest first, capped so one page can never pull the whole archive. */
export async function listDocumentsForProject(
  actor: ActorContext,
  projectId: string,
): Promise<DocumentDTO[]> {
  await assertCanViewProject(actor, projectId);
  const all = await activeDocuments(actor.orgId, projectId);
  const mine = isExternal(actor) ? await keepOwnTaskDocuments(actor, all) : all;
  return toDocumentDTOs(mine.slice(0, PROJECT_DOCUMENT_CAP));
}

/** Every revision of one document, newest first. Nothing is ever missing from this list. */
export async function listVersions(
  actor: ActorContext,
  documentId: string,
): Promise<DocumentVersionDTO[]> {
  const document = await loadDocument(actor, documentId);
  await assertCanViewProject(actor, document.projectId);
  await assertExternalMaySeeDocument(actor, document);

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: document.id },
    orderBy: { revisionNumber: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });

  return checkDtoList(DocumentVersionSchema, versions.map(toVersionDTO), "DocumentVersionDTO");
}

/** What the download route needs to stream one revision, once it is sure the person may see it. */
export async function getVersionForDownload(
  actor: ActorContext,
  versionId: string,
): Promise<{ absolutePath: string; originalFilename: string; mimeType: string; sizeBytes: number }> {
  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, document: { project: { orgId: actor.orgId } } },
    include: {
      document: { select: { projectId: true, deletedAt: true, disciplineTaskId: true } },
    },
  });
  if (!version) throw new NotFoundError("We could not find that file.");
  if (version.document.deletedAt) throw new NotFoundError("That document has been removed.");

  // Downloading goes through exactly the same visibility as listing does — a contractor holding a
  // revision id for somebody else's file is told the file does not exist.
  await assertCanViewProject(actor, version.document.projectId);
  await assertExternalMaySeeDocument(actor, version.document);

  return {
    absolutePath: storedFilePath(version.storedFilename),
    originalFilename: version.originalFilename,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
  };
}

/* ------------------------------------------------------------------ */
/* Pointing at a document from somewhere else (the noticeboard)        */
/* ------------------------------------------------------------------ */

/**
 * The one document a board post is allowed to point at.
 *
 * Everything a document read already asks is asked here, in the same order and through the same
 * helpers, so "attach a document to a post" can never reach further than "open that document"
 * already does: it must be **live**, in the actor's own **company**, on **that project**, on a
 * project the actor may **view**, and — for a contractor, who cannot post at all but is refused
 * here too rather than relying on that — on a task assigned to them.
 *
 * Every miss is the same `NotFoundError`. Another company's id, another project's id, a
 * soft-deleted document and one on a project the author is not a member of all answer identically,
 * so nobody learns an id is real by trying to attach it.
 */
export async function documentForBoardPost(
  actor: ActorContext,
  documentId: string,
  projectId: string,
): Promise<{ id: string }> {
  const document = await loadDocument(actor, documentId);
  if (document.projectId !== projectId) {
    throw new NotFoundError("We could not find that document.");
  }
  await assertCanViewProject(actor, document.projectId);
  await assertExternalMaySeeDocument(actor, document);
  return { id: document.id };
}

/**
 * The documents from a set of ids that THIS reader may actually see, as chips, keyed by id.
 *
 * The whole point is what is NOT in the map: a document that has been removed since it was
 * attached, one on a project this reader is not on, or one belonging to another company simply has
 * no entry, and the card that pointed at it draws nothing. There is no "restricted" state and no
 * teaser — the title never leaves the server for somebody who may not read it.
 *
 * Bounded and batched: one read for the documents, one for the projects this person may see, and
 * one for the revision numbers — the marked current rows fetched by id, never a document's whole
 * append-only history to read a single number off it. Never one query per post.
 */
export async function visibleDocumentChips(
  actor: ActorContext,
  documentIds: string[],
): Promise<Map<string, PostAttachmentDTO>> {
  const chips = new Map<string, PostAttachmentDTO>();
  const wanted = [...new Set(documentIds)];
  if (wanted.length === 0) return chips;

  const rows = await prisma.document.findMany({
    where: { id: { in: wanted }, ...notDeleted, project: { orgId: actor.orgId, ...notDeleted } },
    select: {
      id: true,
      title: true,
      projectId: true,
      mainTaskId: true,
      disciplineTaskId: true,
      currentVersionId: true,
    },
  });
  if (rows.length === 0) return chips;

  // The same set `assertCanViewProject` would accept one at a time: the projects this person is a
  // member of, every project of the company for an administrator, and — for a contractor — only the
  // ones they hold live work on.
  const visibleProjectIds = new Set((await projectsVisibleTo(actor)).map((project) => project.id));
  const onVisibleProjects = rows.filter((row) => visibleProjectIds.has(row.projectId));
  const kept = isExternal(actor)
    ? await keepOwnTaskDocuments(actor, onVisibleProjects)
    : onVisibleProjects;
  if (kept.length === 0) return chips;

  // ONE number per document, and never the whole history to get it. `DocumentVersion` is
  // append-only and a document on a long-running project can carry dozens of revisions, so the
  // chips ask for the marked current rows by id and nothing else. Only a document with no current
  // version marked — which the upload path does not produce, but old or hand-written rows can —
  // falls back, and even then to a grouped `_max` rather than a list of revisions.
  const markedIds = kept
    .map((row) => row.currentVersionId)
    .filter((id): id is string => id !== null);
  const unmarked = kept.filter((row) => row.currentVersionId === null).map((row) => row.id);

  const [marked, highest] = await Promise.all([
    markedIds.length === 0
      ? Promise.resolve([] as { documentId: string; revisionNumber: number }[])
      : prisma.documentVersion.findMany({
          where: { id: { in: markedIds } },
          select: { documentId: true, revisionNumber: true },
        }),
    unmarked.length === 0
      ? Promise.resolve([] as { documentId: string; _max: { revisionNumber: number | null } }[])
      : prisma.documentVersion.groupBy({
          by: ["documentId"],
          where: { documentId: { in: unmarked } },
          _max: { revisionNumber: true },
        }),
  ]);

  const revisionOf = new Map<string, number>();
  for (const version of marked) revisionOf.set(version.documentId, version.revisionNumber);
  for (const group of highest) {
    if (group._max.revisionNumber !== null) {
      revisionOf.set(group.documentId, group._max.revisionNumber);
    }
  }

  for (const row of kept) {
    // A document with no revision at all has nothing to say — no chip rather than a half one.
    const revision = revisionOf.get(row.id);
    if (revision === undefined) continue;

    chips.set(
      row.id,
      checkDto(
        PostAttachmentSchema,
        {
          id: row.id,
          title: row.title,
          revision,
          // There is no standalone document page in this app, so the chip lands where the document
          // actually lives — exactly where the Documents tab's own "Location" link goes.
          linkUrl: row.disciplineTaskId
            ? `/discipline-tasks/${row.disciplineTaskId}`
            : row.mainTaskId
              ? `/tasks/${row.mainTaskId}`
              : `/projects/${row.projectId}`,
        },
        "PostAttachmentDTO",
      ),
    );
  }

  return chips;
}

/* ------------------------------------------------------------------ */
/* Delete (the whole document only — never a revision)                 */
/* ------------------------------------------------------------------ */

/**
 * Removes a document from view. Its revisions and audit rows stay untouched for ever; only the
 * document is marked as deleted. Any checklist item it satisfied is reopened — and if the discipline
 * task that checklist item gates is already complete, the delete is refused, because a completed task
 * must never be left standing on a requirement whose proof has gone.
 */
export async function softDeleteDocument(
  actor: ActorContext,
  input: { id: string },
): Promise<{ deleted: true; projectId: string; mainTaskId: string | null; disciplineTaskId: string | null }> {
  const document = await loadDocument(actor, input.id);
  assertCan(actor, "DELETE_DOCUMENT", {
    projectId: document.projectId,
    orgId: document.project.orgId,
  });

  await prisma.$transaction(async (tx) => {
    // Locking the document row first serialises this against an upload satisfying the same
    // document at the same moment: whichever gets here second waits and then sees the truth.
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${document.id} FOR UPDATE`;

    // Locking every affected parent main task FIRST (same order as the completion gate)
    // serialises this against completeDisciplineTask — the two can never interleave into
    // a completed task whose mandatory proof was just deleted.
    const affected = await tx.requiredDocument.findMany({
      where: { documentId: document.id },
      select: {
        id: true,
        name: true,
        disciplineTask: {
          select: { id: true, title: true, status: true, deletedAt: true, mainTaskId: true },
        },
      },
    });
    const parentIds = [...new Set(affected.map((item) => item.disciplineTask.mainTaskId))].sort();
    for (const mainTaskId of parentIds) {
      await lockMainTask(tx, mainTaskId);
    }

    // Re-read after the locks — the pre-lock rows may be stale.
    const fresh = await tx.requiredDocument.findMany({
      where: { documentId: document.id },
      select: {
        id: true,
        name: true,
        disciplineTask: { select: { id: true, title: true, status: true, deletedAt: true } },
      },
    });
    const onCompletedTask = fresh.find(
      (item) => !item.disciplineTask.deletedAt && item.disciplineTask.status === "COMPLETED",
    );
    if (onCompletedTask) {
      throw new ServiceError(
        "This document satisfies a requirement on a completed task. Reopen the task first.",
      );
    }

    await tx.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });

    for (const item of fresh) {
      await tx.requiredDocument.update({
        where: { id: item.id },
        data: { documentId: null, satisfiedAt: null },
      });
    }

    // The audit row belongs to the same transaction as the delete it records: either both
    // land or neither does.
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: document.projectId,
      entityType: "Document",
      entityId: document.id,
      action: ACTIVITY.DOCUMENT_DELETED,
      summary:
        `${actor.name} removed the document "${document.title}"` +
        (fresh.length > 0
          ? ` — ${fresh.length === 1 ? "1 checklist item is" : `${fresh.length} checklist items are`} open again`
          : ""),
      metadata: {
        documentId: document.id,
        reopenedRequirements: fresh.map((item) => ({ id: item.id, name: item.name })),
        versionsKept: await tx.documentVersion.count({ where: { documentId: document.id } }),
      },
    });
  });

  // The main task the document showed up under, so the caller knows which pages to refresh.
  const parent = document.disciplineTaskId
    ? await prisma.disciplineTask.findUnique({
        where: { id: document.disciplineTaskId },
        select: { mainTaskId: true },
      })
    : null;

  return {
    deleted: true,
    projectId: document.projectId,
    mainTaskId: document.mainTaskId ?? parent?.mainTaskId ?? null,
    disciplineTaskId: document.disciplineTaskId,
  };
}

/* ------------------------------------------------------------------ */
/* Target resolution                                                   */
/* ------------------------------------------------------------------ */

type UploadTarget = {
  projectId: string;
  /** The organisation the project belongs to, read from the project row itself. */
  orgId: string;
  /** Set when this upload is a new revision of a document that already exists. */
  documentId: string | null;
  mainTaskId: string | null;
  disciplineTaskId: string | null;
  disciplineId: string | null;
  assigneeId: string | null;
  linkUrl: string;
  /** The main task's owner, or the discipline task's assignee — whoever is waiting for the file. */
  ownerId: string | null;
};

const ONE_TARGET =
  "Say where the file belongs: a main task, a discipline task, or the document it is a new revision of.";

async function resolveTarget(actor: ActorContext, meta: UploadMeta): Promise<UploadTarget> {
  const targets = [meta.mainTaskId, meta.disciplineTaskId, meta.documentId].filter(Boolean);
  if (targets.length !== 1) throw new ServiceError(ONE_TARGET);

  const project = await prisma.project.findFirst({
    where: { id: meta.projectId, orgId: actor.orgId, ...notDeleted },
    select: { id: true, orgId: true },
  });
  if (!project) throw new NotFoundError("We could not find that project.");

  if (meta.documentId) {
    const document = await loadDocument(actor, meta.documentId);
    if (document.projectId !== project.id) {
      throw new ServiceError("That document belongs to a different project.");
    }
    const base = document.disciplineTaskId
      ? await disciplineTaskTarget(actor, project, document.disciplineTaskId)
      : document.mainTaskId
        ? await mainTaskTarget(actor, project, document.mainTaskId)
        : {
            projectId: project.id,
            orgId: project.orgId,
            mainTaskId: null,
            disciplineTaskId: null,
            disciplineId: null,
            assigneeId: null,
            linkUrl: `/projects/${project.id}`,
            ownerId: null,
          };
    return { ...base, documentId: document.id };
  }

  if (meta.disciplineTaskId) {
    return { ...(await disciplineTaskTarget(actor, project, meta.disciplineTaskId)), documentId: null };
  }

  return { ...(await mainTaskTarget(actor, project, meta.mainTaskId as string)), documentId: null };
}

type TargetProject = { id: string; orgId: string };

async function mainTaskTarget(
  actor: ActorContext,
  project: TargetProject,
  mainTaskId: string,
): Promise<Omit<UploadTarget, "documentId">> {
  const task = await prisma.mainTask.findFirst({
    where: {
      id: mainTaskId,
      ...notDeleted,
      project: { orgId: project.orgId },
      ...(isExternal(actor)
        ? { disciplineTasks: { some: { assigneeId: actor.userId, ...notDeleted } } }
        : {}),
    },
    select: { id: true, projectId: true, ownerId: true },
  });
  if (!task) throw new NotFoundError("We could not find that task.");
  if (task.projectId !== project.id) throw new ServiceError("That task is not part of this project.");

  return {
    projectId: project.id,
    orgId: project.orgId,
    mainTaskId: task.id,
    disciplineTaskId: null,
    disciplineId: null,
    assigneeId: null,
    linkUrl: `/tasks/${task.id}`,
    ownerId: task.ownerId,
  };
}

async function disciplineTaskTarget(
  actor: ActorContext,
  project: TargetProject,
  disciplineTaskId: string,
): Promise<Omit<UploadTarget, "documentId">> {
  const task = await prisma.disciplineTask.findFirst({
    where: {
      id: disciplineTaskId,
      ...notDeleted,
      ...externalTaskScope(actor),
      mainTask: { project: { orgId: project.orgId } },
    },
    select: {
      id: true,
      disciplineId: true,
      assigneeId: true,
      mainTask: { select: { projectId: true } },
    },
  });
  if (!task) throw new NotFoundError("We could not find that task.");
  if (task.mainTask.projectId !== project.id) {
    throw new ServiceError("That task is not part of this project.");
  }

  return {
    projectId: project.id,
    orgId: project.orgId,
    mainTaskId: null,
    disciplineTaskId: task.id,
    disciplineId: task.disciplineId,
    assigneeId: task.assigneeId,
    linkUrl: `/discipline-tasks/${task.id}`,
    ownerId: task.assigneeId,
  };
}

/** A checklist item may only ever be satisfied by a file uploaded to its own discipline task. */
async function resolveRequiredDocument(
  meta: UploadMeta,
  target: UploadTarget,
): Promise<{ id: string; name: string } | null> {
  if (!meta.requiredDocumentId) return null;

  const item = await prisma.requiredDocument.findFirst({
    where: {
      id: meta.requiredDocumentId,
      disciplineTask: { mainTask: { project: { orgId: target.orgId } } },
    },
    select: { id: true, name: true, disciplineTaskId: true },
  });
  if (!item) throw new NotFoundError("We could not find that required document.");

  if (!target.disciplineTaskId || item.disciplineTaskId !== target.disciplineTaskId) {
    throw new ServiceError(
      "That required document belongs to a different task. Upload the file to that task instead.",
    );
  }

  return { id: item.id, name: item.name };
}

/* ------------------------------------------------------------------ */
/* Serializers and small helpers                                       */
/* ------------------------------------------------------------------ */

type VersionRow = {
  id: string;
  documentId: string;
  revisionNumber: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedById: string;
  note: string | null;
  createdAt: Date;
  uploadedBy: { name: string };
};

function toVersionDTO(row: VersionRow): DocumentVersionDTO {
  return {
    id: row.id,
    documentId: row.documentId,
    revisionNumber: row.revisionNumber,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedBy.name,
    note: row.note,
    createdAt: row.createdAt,
    downloadUrl: `/api/documents/versions/${row.id}/download`,
  };
}

/** One revision in full — what an upload hands back. */
export async function buildVersionDTO(versionId: string): Promise<DocumentVersionDTO> {
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: { uploadedBy: { select: { name: true } } },
  });
  if (!version) throw new NotFoundError("We could not find that file.");
  return checkDto(DocumentVersionSchema, toVersionDTO(version), "DocumentVersionDTO");
}

type DocumentRow = {
  id: string;
  projectId: string;
  mainTaskId: string | null;
  disciplineTaskId: string | null;
  title: string;
  category: string | null;
  currentVersionId: string | null;
  uploadedById: string;
  createdAt: Date;
};

/** Turns live document rows into DTOs, with their current revision and how many revisions there are. */
export async function toDocumentDTOs(rows: DocumentRow[]): Promise<DocumentDTO[]> {
  if (rows.length === 0) return [];

  const documentIds = rows.map((row) => row.id);
  const [versions, uploaders] = await Promise.all([
    prisma.documentVersion.findMany({
      where: { documentId: { in: documentIds } },
      orderBy: { revisionNumber: "desc" },
      include: { uploadedBy: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.uploadedById))] } },
      select: { id: true, name: true, companyName: true },
    }),
  ]);

  const nameById = new Map(uploaders.map((user) => [user.id, user.name]));
  const companyById = new Map(uploaders.map((user) => [user.id, user.companyName]));
  const byDocument = new Map<string, VersionRow[]>();
  for (const version of versions) {
    const list = byDocument.get(version.documentId) ?? [];
    list.push(version);
    byDocument.set(version.documentId, list);
  }

  const items = rows.map((row): DocumentDTO => {
    const own = byDocument.get(row.id) ?? [];
    const current = own.find((version) => version.id === row.currentVersionId) ?? own[0] ?? null;
    return {
      id: row.id,
      projectId: row.projectId,
      mainTaskId: row.mainTaskId,
      disciplineTaskId: row.disciplineTaskId,
      title: row.title,
      category: row.category,
      uploadedById: row.uploadedById,
      uploadedByName: nameById.get(row.uploadedById) ?? "Someone",
      uploadedByCompanyName: companyById.get(row.uploadedById) ?? null,
      createdAt: row.createdAt,
      currentRevision: current ? toVersionDTO(current) : null,
      versionsCount: own.length,
    };
  });

  return checkDtoList(DocumentSchema, items, "DocumentDTO");
}

/** Of a set of documents, the ones hanging off this contractor's own live discipline tasks. */
async function keepOwnTaskDocuments<T extends { disciplineTaskId: string | null }>(
  actor: ActorContext,
  rows: T[],
): Promise<T[]> {
  const ids = [...new Set(rows.map((row) => row.disciplineTaskId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];
  const mine = await prisma.disciplineTask.findMany({
    where: { id: { in: ids }, assigneeId: actor.userId, ...notDeleted },
    select: { id: true },
  });
  const allowed = new Set(mine.map((row) => row.id));
  return rows.filter((row) => row.disciplineTaskId !== null && allowed.has(row.disciplineTaskId));
}

/** A contractor may only reach a document that sits on a discipline task assigned to them. */
async function assertExternalMaySeeDocument(
  actor: ActorContext,
  document: { disciplineTaskId: string | null },
): Promise<void> {
  if (!isExternal(actor)) return;
  const kept = await keepOwnTaskDocuments(actor, [document]);
  if (kept.length === 0) throw new NotFoundError("We could not find that document.");
}

/**
 * The tenant gate for documents: a document in another company's project does not exist here.
 * Its project's orgId rides along so the permission check is made against the row's own company.
 */
async function loadDocument(actor: ActorContext, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, ...notDeleted, project: { orgId: actor.orgId } },
    include: { project: { select: { orgId: true } } },
  });
  if (!document) throw new NotFoundError("We could not find that document.");
  return document;
}

/** Tells the people waiting for the file that it has arrived — never the person who uploaded it. */
async function notifyWatchers(actor: ActorContext, target: UploadTarget, filename: string): Promise<void> {
  const recipients = new Set<string>();
  if (target.ownerId) recipients.add(target.ownerId);

  if (target.disciplineId) {
    const discipline = await prisma.projectDiscipline.findUnique({
      where: { projectId_disciplineId: { projectId: target.projectId, disciplineId: target.disciplineId } },
      select: { leadId: true },
    });
    if (discipline?.leadId) recipients.add(discipline.leadId);
  }

  recipients.delete(actor.userId);
  if (recipients.size === 0) return;

  await notify(actor, [...recipients], "DOCUMENT_UPLOADED", {
    title: "A new document was uploaded",
    body: `${actor.name} uploaded ${filename}.`,
    linkUrl: target.linkUrl,
  });
}

function withoutExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.trim().slice(0, 200) || filename;
}

/** True when two uploads raced for the same revision number and the unique constraint stopped one of them. */
function isRevisionClash(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
