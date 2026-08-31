// DATA RIGHTS, the deleting half: a person removing themselves, and a company removing itself.
//
// The two promises being proved here are opposites, and both matter:
//  - Deleting an ACCOUNT takes the person off every screen and leaves the work exactly where it is.
//  - Deleting a WORKSPACE leaves nothing at all — and touches no other company's rows or files,
//    which is the tenant rule at its most dangerous moment.

import { mkdir, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-deletion");
process.env.SWEEP_DISABLED = "1";

import { hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { storeFile, storedFilePath, validateUpload } from "@/lib/upload";
import { actorForUser } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import { runSweepOnce } from "@/server/sweep";
import { ACTIVITY } from "@/server/services/activity";
import {
  FORMER_MEMBER,
  SOLE_ADMIN_REFUSAL,
  deleteMyAccount,
  emailTombstone,
} from "@/server/services/account-deletion";
import { createComment, listComments } from "@/server/services/comments";
import { uploadDocumentVersion } from "@/server/services/documents";
import { toggleFavorite } from "@/server/services/favorites";
import { saveIntegration } from "@/server/services/integrations";
import { createPersonalTask } from "@/server/services/personal-tasks";
import { createPhase } from "@/server/services/phases";
import { acknowledgePost, createPost, dismissAnnouncement } from "@/server/services/posts";
import { addDependency, createMainTask, setMainTaskPhase } from "@/server/services/tasks";
import { issueEmailToken } from "@/server/services/email-tokens";
import {
  WORKSPACE_DELETION_GRACE_MS,
  cancelWorkspaceDeletion,
  requestWorkspaceDeletion,
  workspaceDeletionStatus,
} from "@/server/services/workspace-deletion";
import { exportFilePath } from "@/server/services/workspace-export";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

const SLACK_URL = "https://hooks.slack.com/services/T00000000/B00000000/deletionTEST";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

/* ------------------------------------------------------------------ */
/* Shared scaffolding                                                  */
/* ------------------------------------------------------------------ */

type Seeded = {
  mainTaskId: string;
  disciplineTaskId: string;
  commentId: string;
  postId: string;
  uploadPath: string;
  exportPath: string;
};

/**
 * One of everything, so "the whole company is gone" cannot pass because a table happened to be
 * empty. Every model that hangs off an Organization gets at least one row.
 */
async function seedEverything(target: Fixture, marker: string): Promise<Seeded> {
  const deadline = inThirtyDays();

  const mainTask = await createMainTask(target.adminActor, {
    projectId: target.projectId,
    title: `${marker} main task`,
    description: `Everything about ${marker}.`,
    priority: "MEDIUM",
    deadline,
    ownerId: target.pmActor.userId,
    disciplineTasks: [
      {
        disciplineId: target.disciplineId,
        title: `${marker} first`,
        assigneeId: target.engineerActor.userId,
        deadline,
        isMandatory: true,
        requiredDocuments: [{ name: `${marker} drawing`, isMandatory: true }],
      },
      {
        disciplineId: target.disciplineId,
        title: `${marker} second`,
        assigneeId: target.engineerActor.userId,
        deadline,
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });

  const subtasks = await subtaskIdsByTitle(mainTask.id);
  const first = subtasks.get(`${marker} first`) as string;
  const second = subtasks.get(`${marker} second`) as string;
  await addDependency(target.adminActor, { predecessorId: first, successorId: second });

  const phase = await createPhase(target.adminActor, {
    projectId: target.projectId,
    name: `${marker} phase`,
  });
  await setMainTaskPhase(target.adminActor, { id: mainTask.id, phaseId: phase.id });

  // A comment that mentions somebody, which writes the comment AND a notification.
  const comment = await createComment(target.pmActor, {
    disciplineTaskId: first,
    body: `A note from ${marker}.`,
    mentions: [target.engineerActor.userId],
  });

  // A real uploaded file, so there is something on disk to lose.
  const buffer = Buffer.from(`line,value\n1,${marker}\n`, "utf8");
  const checked = validateUpload(buffer, `${marker}.csv`);
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);
  await uploadDocumentVersion(
    target.pmActor,
    { projectId: target.projectId, mainTaskId: mainTask.id },
    {
      buffer,
      originalName: `${marker}.csv`,
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    },
  );

  // The noticeboard: an announcement that asks to be acknowledged, then acknowledged and dismissed.
  const post = await createPost(target.adminActor, {
    kind: "ANNOUNCEMENT",
    body: `${marker} announcement.`,
    title: `${marker} notice`,
    requiresAck: true,
  });
  await acknowledgePost(target.engineerActor, { id: post.id });
  await dismissAnnouncement(target.engineerActor, { id: post.id });

  // Personal rows, a chat integration, a Microsoft connection, a session and an email link.
  await toggleFavorite(target.engineerActor, { targetType: "PROJECT", targetId: target.projectId });
  await createPersonalTask(target.engineerActor, { title: `${marker} reminder` });
  await saveIntegration(target.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
  await prisma.microsoftConnection.create({
    data: {
      orgId: target.orgId,
      tenantId: `${marker}-tenant`,
      connectedById: target.adminActor.userId,
      refreshTokenEnc: "not-a-real-token",
    },
  });
  await prisma.session.create({
    data: {
      userId: target.engineerActor.userId,
      tokenHash: `${marker}-session-hash`,
      expiresAt: inThirtyDays(),
    },
  });
  await issueEmailToken(target.engineerActor.userId, "RESET");

  // An export archive: the audit row names the file, which is why the row has to be read before
  // the activity log is emptied.
  const exportRow = await prisma.activityLog.create({
    data: {
      actorId: target.adminActor.userId,
      entityType: "Organization",
      entityId: target.orgId,
      action: ACTIVITY.EXPORT_STARTED,
      summary: "An export was asked for",
    },
    select: { id: true },
  });
  const exportPath = exportFilePath(exportRow.id);
  await mkdir(path.dirname(exportPath), { recursive: true });
  await writeFile(exportPath, `${marker} archive`);

  return {
    mainTaskId: mainTask.id,
    disciplineTaskId: first,
    commentId: comment.id,
    postId: post.id,
    uploadPath: storedFilePath(stored.storedFilename),
    exportPath,
  };
}

/** Every table that hangs off an Organization, counted for one company. */
async function rowCounts(orgId: string): Promise<Record<string, number>> {
  const ofOrg = { project: { orgId } };
  return {
    organization: await prisma.organization.count({ where: { id: orgId } }),
    user: await prisma.user.count({ where: { orgId } }),
    discipline: await prisma.discipline.count({ where: { orgId } }),
    project: await prisma.project.count({ where: { orgId } }),
    projectPhase: await prisma.projectPhase.count({ where: ofOrg }),
    projectMember: await prisma.projectMember.count({ where: ofOrg }),
    projectDiscipline: await prisma.projectDiscipline.count({ where: ofOrg }),
    mainTask: await prisma.mainTask.count({ where: ofOrg }),
    disciplineTask: await prisma.disciplineTask.count({ where: { mainTask: ofOrg } }),
    taskDependency: await prisma.taskDependency.count({
      where: { successor: { mainTask: ofOrg } },
    }),
    requiredDocument: await prisma.requiredDocument.count({
      where: { disciplineTask: { mainTask: ofOrg } },
    }),
    document: await prisma.document.count({ where: ofOrg }),
    documentVersion: await prisma.documentVersion.count({ where: { document: ofOrg } }),
    comment: await prisma.comment.count({
      where: { OR: [{ mainTask: ofOrg }, { disciplineTask: { mainTask: ofOrg } }] },
    }),
    notification: await prisma.notification.count({ where: { user: { orgId } } }),
    activityLog: await prisma.activityLog.count({
      where: { OR: [{ project: { orgId } }, { actor: { orgId } }] },
    }),
    post: await prisma.post.count({ where: { orgId } }),
    postAck: await prisma.postAck.count({ where: { post: { orgId } } }),
    postDismissal: await prisma.postDismissal.count({ where: { post: { orgId } } }),
    favorite: await prisma.favorite.count({ where: { user: { orgId } } }),
    personalTask: await prisma.personalTask.count({ where: { user: { orgId } } }),
    emailToken: await prisma.emailToken.count({ where: { user: { orgId } } }),
    session: await prisma.session.count({ where: { user: { orgId } } }),
    orgIntegration: await prisma.orgIntegration.count({ where: { orgId } }),
    microsoftConnection: await prisma.microsoftConnection.count({ where: { orgId } }),
  };
}

const onDisk = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null)) !== null;

/* ------------------------------------------------------------------ */
/* Feature 1 — deleting your own account                               */
/* ------------------------------------------------------------------ */

describe("deleting your own account", () => {
  it("anonymises every personal field and closes every way back in", async () => {
    const seeded = await seedEverything(fixture, "Alpha");
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.engineerActor.userId },
    });

    await prisma.user.update({
      where: { id: before.id },
      data: {
        jobTitle: "Lead engineer",
        companyName: "Contractors Ltd",
        accessExpiresAt: inThirtyDays(),
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword("correct horse battery"),
      },
    });

    await deleteMyAccount(fixture.engineerActor, { confirm: "DELETE" });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.name).toBe(FORMER_MEMBER);
    expect(after.email).toBe(emailTombstone(before.id));
    expect(after.email).not.toContain(before.email);
    expect(after.jobTitle).toBeNull();
    expect(after.companyName).toBeNull();
    expect(after.disciplineId).toBeNull();
    expect(after.accessExpiresAt).toBeNull();
    expect(after.emailVerifiedAt).toBeNull();
    expect(after.isActive).toBe(false);
    // The password nobody can type any more — not the old one, and not a blank.
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(await verifyPassword(after.passwordHash, "correct horse battery")).toBe(false);

    expect(await prisma.session.count({ where: { userId: before.id } })).toBe(0);
    expect(await prisma.emailToken.count({ where: { userId: before.id } })).toBe(0);

    // Personal preference rows go; the attestation stays, because somebody relied on it.
    expect(await prisma.favorite.count({ where: { userId: before.id } })).toBe(0);
    expect(await prisma.personalTask.count({ where: { userId: before.id } })).toBe(0);
    expect(await prisma.postDismissal.count({ where: { userId: before.id } })).toBe(0);
    expect(await prisma.postAck.count({ where: { userId: before.id, postId: seeded.postId } })).toBe(1);
  });

  it("leaves the work in place, rendered as Former member", async () => {
    const seeded = await seedEverything(fixture, "Alpha");
    const authorName = fixture.pmActor.name;

    await deleteMyAccount(fixture.pmActor, { confirm: "DELETE" });

    // The rows themselves are untouched.
    const comment = await prisma.comment.findUniqueOrThrow({ where: { id: seeded.commentId } });
    expect(comment.body).toBe("A note from Alpha.");
    expect(comment.deletedAt).toBeNull();
    expect(
      await prisma.documentVersion.count({ where: { uploadedById: fixture.pmActor.userId } }),
    ).toBe(1);

    // And every screen that shows a name reads it off the User row, so one rename does them all.
    const thread = await listComments(fixture.adminActor, {
      disciplineTaskId: seeded.disciplineTaskId,
    });
    expect(thread).toHaveLength(1);
    expect(thread[0].authorName).toBe(FORMER_MEMBER);
    expect(thread[0].authorName).not.toBe(authorName);
  });

  it("writes one audit row that does not name them", async () => {
    const name = fixture.engineerActor.name;
    await deleteMyAccount(fixture.engineerActor, { confirm: "DELETE" });

    const rows = await prisma.activityLog.findMany({
      where: { action: ACTIVITY.ACCOUNT_DELETED },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(fixture.engineerActor.userId);
    expect(rows[0].entityId).toBe(fixture.engineerActor.userId);
    expect(rows[0].summary).not.toContain(name);
    expect(JSON.stringify(rows[0].metadata)).not.toContain(name);
  });

  it("refuses the only administrator, and changes nothing", async () => {
    await expect(deleteMyAccount(fixture.adminActor, { confirm: "DELETE" })).rejects.toThrow(
      SOLE_ADMIN_REFUSAL,
    );

    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.adminActor.userId },
    });
    expect(admin.name).toBe(fixture.adminActor.name);
    expect(admin.isActive).toBe(true);
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.ACCOUNT_DELETED } })).toBe(0);
  });

  it("lets an administrator go once somebody else can administer — but not the survivor after them", async () => {
    const second = await makeUser({ name: "Second Admin", role: "ADMIN", orgId: fixture.orgId });
    const secondActor = await actorForUser(second.id);

    await deleteMyAccount(fixture.adminActor, { confirm: "DELETE" });

    const gone = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminActor.userId } });
    expect(gone.name).toBe(FORMER_MEMBER);
    expect(gone.isActive).toBe(false);
    const survivor = await prisma.user.findUniqueOrThrow({ where: { id: second.id } });
    expect(survivor.isActive).toBe(true);

    // The one who is left is now the last one, and is refused on the spot.
    await expect(deleteMyAccount(secondActor, { confirm: "DELETE" })).rejects.toThrow(
      SOLE_ADMIN_REFUSAL,
    );
    expect(
      await prisma.user.count({ where: { orgId: fixture.orgId, role: "ADMIN", isActive: true } }),
    ).toBe(1);
  });

  it("never lets a company's last two administrators delete themselves at the same moment", async () => {
    // THE RACE. Counting administrators before the transaction would let both of these pass their
    // check, both commit, and leave the company with nobody able to run it and no way back in.
    // The company's Organization row is locked FOR UPDATE inside each transaction, so the second
    // one waits, counts one administrator, and is refused.
    const second = await makeUser({ name: "Second Admin", role: "ADMIN", orgId: fixture.orgId });
    const secondActor = await actorForUser(second.id);

    const outcomes = await Promise.allSettled([
      deleteMyAccount(fixture.adminActor, { confirm: "DELETE" }),
      deleteMyAccount(secondActor, { confirm: "DELETE" }),
    ]);

    const done = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(done).toHaveLength(1);
    expect(refused).toHaveLength(1);

    // The only thing that really matters: somebody can still administer this company.
    expect(
      await prisma.user.count({ where: { orgId: fixture.orgId, role: "ADMIN", isActive: true } }),
    ).toBe(1);
  });

  it("lets a contractor delete themselves like anybody else", async () => {
    const contractor = await makeUser({ name: "Nadia Contractor", role: "EXTERNAL", orgId: fixture.orgId });
    await prisma.user.update({
      where: { id: contractor.id },
      data: { companyName: "Falcon Engineering", accessExpiresAt: inThirtyDays() },
    });
    const contractorActor = await actorForUser(contractor.id);

    await deleteMyAccount(contractorActor, { confirm: "DELETE" });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: contractor.id } });
    expect(after.name).toBe(FORMER_MEMBER);
    expect(after.companyName).toBeNull();
    expect(after.accessExpiresAt).toBeNull();
  });

  it("refuses anything but the confirmation word", async () => {
    await expect(deleteMyAccount(fixture.engineerActor, { confirm: "delete" })).rejects.toBeInstanceOf(
      ServiceError,
    );
    const still = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.engineerActor.userId },
    });
    expect(still.isActive).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Feature 2 — deleting the whole workspace                            */
/* ------------------------------------------------------------------ */

describe("asking for a workspace to be deleted", () => {
  it("schedules it seven days out, audits it and tells the other administrators", async () => {
    const other = await makeUser({ name: "Second Admin", role: "ADMIN", orgId: fixture.orgId });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });

    const status = await requestWorkspaceDeletion(fixture.adminActor, { confirmName: org.name });

    expect(status.pending).toBe(true);
    expect(status.requestedByName).toBe(fixture.adminActor.name);
    expect(status.daysLeft).toBe(7);
    expect(status.deletesOn?.getTime()).toBe(
      (status.requestedAt as Date).getTime() + WORKSPACE_DELETION_GRACE_MS,
    );

    const row = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });
    expect(row.deleteRequestedAt).not.toBeNull();
    expect(row.deleteRequestedById).toBe(fixture.adminActor.userId);

    expect(
      await prisma.activityLog.count({
        where: { action: ACTIVITY.WORKSPACE_DELETION_REQUESTED, entityId: fixture.orgId },
      }),
    ).toBe(1);

    // The other administrator hears about it; the one who asked does not tell themselves.
    expect(await prisma.notification.count({ where: { userId: other.id } })).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: fixture.adminActor.userId } }),
    ).toBe(0);
  });

  it("refuses a name that does not match, and refuses anyone who is not an administrator", async () => {
    await expect(
      requestWorkspaceDeletion(fixture.adminActor, { confirmName: "Some Other Company" }),
    ).rejects.toBeInstanceOf(ServiceError);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });
    expect(org.deleteRequestedAt).toBeNull();

    await expect(
      requestWorkspaceDeletion(fixture.pmActor, { confirmName: org.name }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cancels cleanly, from any administrator, with its own audit row", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });
    const second = await makeUser({ name: "Second Admin", role: "ADMIN", orgId: fixture.orgId });
    const secondActor = await actorForUser(second.id);

    await requestWorkspaceDeletion(fixture.adminActor, { confirmName: org.name });
    const cancelled = await cancelWorkspaceDeletion(secondActor);

    expect(cancelled.pending).toBe(false);
    expect(cancelled.deletesOn).toBeNull();

    const row = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });
    expect(row.deleteRequestedAt).toBeNull();
    expect(row.deleteRequestedById).toBeNull();

    expect(
      await prisma.activityLog.count({
        where: { action: ACTIVITY.WORKSPACE_DELETION_CANCELLED, entityId: fixture.orgId },
      }),
    ).toBe(1);

    // And the danger card reads it back as idle.
    expect((await workspaceDeletionStatus(fixture.adminActor)).pending).toBe(false);
  });
});

describe("the sweep that finally deletes a workspace", () => {
  let beta: Fixture;
  let alphaSeed: Seeded;
  let betaSeed: Seeded;
  let alphaName: string;

  beforeEach(async () => {
    alphaSeed = await seedEverything(fixture, "Alpha");
    beta = await makeProjectFixture((await makeOrg("Beta Engineering")).id);
    betaSeed = await seedEverything(beta, "Beta");
    alphaName = (await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } })).name;
  });

  const dayAfterTheGrace = (from: Date): Date =>
    new Date(from.getTime() + WORKSPACE_DELETION_GRACE_MS + 60_000);

  it("does nothing at all before the seven days are up", async () => {
    const asked = new Date();
    await requestWorkspaceDeletion(fixture.adminActor, { confirmName: alphaName }, asked);

    // One minute short of the deadline.
    await runSweepOnce(new Date(asked.getTime() + WORKSPACE_DELETION_GRACE_MS - 60_000));

    const counts = await rowCounts(fixture.orgId);
    expect(counts.organization).toBe(1);
    expect(counts.user).toBeGreaterThan(0);
    expect(await onDisk(alphaSeed.uploadPath)).toBe(true);
  });

  it("removes every row and every file of that company, and nothing of the next one", async () => {
    const asked = new Date();
    await requestWorkspaceDeletion(fixture.adminActor, { confirmName: alphaName }, asked);

    // The fixture has to be worth deleting, or "everything is gone" proves nothing.
    const before = await rowCounts(fixture.orgId);
    for (const [table, count] of Object.entries(before)) {
      expect(count, `${table} should have rows before the sweep`).toBeGreaterThan(0);
    }
    const betaBefore = await rowCounts(beta.orgId);

    // The same sweep also deletes export archives older than 48 hours, and this test moves the
    // clock a week forward — so both archives are touched to that moment first. Otherwise the
    // housekeeping would remove the surviving company's archive and hide what is being proved.
    const when = dayAfterTheGrace(asked);
    await utimes(alphaSeed.exportPath, when, when);
    await utimes(betaSeed.exportPath, when, when);

    await runSweepOnce(when);

    const after = await rowCounts(fixture.orgId);
    for (const [table, count] of Object.entries(after)) {
      expect(count, `${table} should be empty after the sweep`).toBe(0);
    }

    // THE CRITICAL TENANT TEST: the company next door is untouched, row for row.
    expect(await rowCounts(beta.orgId)).toEqual(betaBefore);

    // Files: the deleted company's are gone, the other company's are still there.
    expect(await onDisk(alphaSeed.uploadPath)).toBe(false);
    expect(await onDisk(alphaSeed.exportPath)).toBe(false);
    expect(await onDisk(betaSeed.uploadPath)).toBe(true);
    expect(await onDisk(betaSeed.exportPath)).toBe(true);

    // Nothing that could sign in is left: the accounts themselves no longer exist.
    expect(await prisma.user.findUnique({ where: { email: fixture.adminActor.email } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: beta.adminActor.email } })).not.toBeNull();
  });

  it("stops the moment somebody cancels", async () => {
    const asked = new Date();
    await requestWorkspaceDeletion(fixture.adminActor, { confirmName: alphaName }, asked);
    await cancelWorkspaceDeletion(fixture.adminActor);

    await runSweepOnce(dayAfterTheGrace(asked));

    const counts = await rowCounts(fixture.orgId);
    expect(counts.organization).toBe(1);
    expect(counts.documentVersion).toBeGreaterThan(0);
    expect(await onDisk(alphaSeed.uploadPath)).toBe(true);
    expect(betaSeed.postId).toBeTruthy();
  });
});
