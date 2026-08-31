// Service-level tests for the noticeboard, run against DATABASE_URL_TEST with a clean database.
//
// The rules being proved: who may post to which audience (including the company's own broadcast
// setting), that you only see the audiences you belong to, that a reply is always one level deep,
// that a dismissal is one person's own, that an expired announcement stops showing, that a removed
// post leaves a tombstone, and that an announcement's fan-out never reaches a contractor.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { actorForUser, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { personBrief } from "@/server/services/briefs";
import { listActivity } from "@/server/services/comments";
import { getDashboardForActor } from "@/server/services/dashboard";
import {
  acknowledgePost,
  createPost,
  deletePost,
  dismissAnnouncement,
  editPost,
  listAnnouncementsForUser,
  listAudiences,
  listBoard,
  replyToPost,
  setBroadcastPolicy,
} from "@/server/services/posts";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  type Fixture,
} from "@/server/__tests__/harness";

let fixture: Fixture;
/** The lead of MECH (the fixture's first discipline), on the fixture's project. */
let leadActor: ActorContext;
/** The lead of ELEC (the fixture's other discipline), on the same project. */
let otherLeadActor: ActorContext;

const EVERYONE = { kind: "EVERYONE" as const, projectId: null, disciplineId: null };

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();

  const lead = await makeUser({
    name: "Salim al-Hinai",
    role: "DISCIPLINE_LEAD",
    disciplineId: fixture.disciplineId,
    orgId: fixture.orgId,
  });
  const otherLead = await makeUser({
    name: "Maryam al-Balushi",
    role: "DISCIPLINE_LEAD",
    disciplineId: fixture.otherDisciplineId,
    orgId: fixture.orgId,
  });
  await prisma.projectMember.createMany({
    data: [
      {
        projectId: fixture.projectId,
        userId: lead.id,
        projectRole: "DISCIPLINE_LEAD",
        disciplineId: fixture.disciplineId,
      },
      {
        projectId: fixture.projectId,
        userId: otherLead.id,
        projectRole: "DISCIPLINE_LEAD",
        disciplineId: fixture.otherDisciplineId,
      },
    ],
  });

  leadActor = await actorForUser(lead.id);
  otherLeadActor = await actorForUser(otherLead.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const projectAudience = () => ({
  kind: "PROJECT" as const,
  projectId: fixture.projectId,
  disciplineId: null,
});

const disciplineAudience = (disciplineId: string) => ({
  kind: "DISCIPLINE" as const,
  projectId: null,
  disciplineId,
});

/** A contractor with one live discipline task on the fixture's project. */
async function makeExternal(): Promise<ActorContext> {
  const contractor = await makeUser({
    name: "Idris Contractor",
    role: "EXTERNAL",
    disciplineId: fixture.disciplineId,
    orgId: fixture.orgId,
  });
  await prisma.user.update({
    where: { id: contractor.id },
    data: { companyName: "Al Bahja Contracting" },
  });
  await prisma.projectMember.create({
    data: {
      projectId: fixture.projectId,
      userId: contractor.id,
      projectRole: "EXTERNAL",
      disciplineId: fixture.disciplineId,
    },
  });
  return actorForUser(contractor.id);
}

/** Gives a contractor one live discipline task, which is what makes a project theirs. */
async function giveWorkOn(
  contractor: ActorContext,
  projectId: string,
  title = "Contractor weld inspection",
): Promise<string> {
  const mainTask = await prisma.mainTask.create({
    data: {
      projectId,
      title: `Parent of ${title}`,
      description: "Parent task.",
      priority: "MEDIUM",
      deadline: inThirtyDays(),
      createdById: fixture.adminActor.userId,
      ownerId: fixture.pmActor.userId,
    },
  });
  const task = await prisma.disciplineTask.create({
    data: {
      mainTaskId: mainTask.id,
      disciplineId: fixture.disciplineId,
      title,
      assigneeId: contractor.userId,
      assignedById: fixture.adminActor.userId,
      deadline: inThirtyDays(),
      isMandatory: true,
    },
  });
  return task.id;
}

/** A document with one revision, filed straight onto a project. */
async function makeDocument(
  projectId: string,
  title: string,
  uploadedById = fixture.adminActor.userId,
): Promise<{ id: string }> {
  const document = await prisma.document.create({
    data: { projectId, title, category: "Datasheet", uploadedById },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      revisionNumber: 1,
      storedFilename: `${document.id}.pdf`,
      originalFilename: `${title}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      checksumSha256: "a".repeat(64),
      uploadedById,
    },
  });
  await prisma.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return { id: document.id };
}

/* ------------------------------------------------------------------ */

describe("who may post where", () => {
  it("lets an administrator post to any audience in their own company", async () => {
    for (const audience of [
      { projectId: null, disciplineId: null },
      { projectId: fixture.projectId, disciplineId: null },
      { projectId: null, disciplineId: fixture.otherDisciplineId },
    ]) {
      const post = await createPost(fixture.adminActor, {
        kind: "BOARD",
        body: "Admin says hello.",
        ...audience,
      });
      expect(post.id).toBeTruthy();
    }
  });

  it("lets a project manager post to their own project but not to somebody else's", async () => {
    const mine = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Kick-off is Thursday.",
    });
    expect(mine.audience.kind).toBe("PROJECT");

    // A second project in the same company that this manager is not a member of.
    const other = await prisma.project.create({
      data: {
        orgId: fixture.orgId,
        name: "Somebody else's project",
        code: `OTHER-${Math.floor(Math.random() * 1_000_000)}`,
        description: "Another project in the same company.",
        createdById: fixture.adminActor.userId,
      },
    });
    // Not a member of it at all, so it is not even a board they can see.
    await expect(
      createPost(fixture.pmActor, {
        kind: "BOARD",
        projectId: other.id,
        body: "Not my project.",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a discipline lead post to their own department and refuses another one", async () => {
    const mine = await createPost(leadActor, {
      kind: "BOARD",
      disciplineId: fixture.disciplineId,
      body: "Mechanical stand-up moved.",
    });
    expect(mine.audience.kind).toBe("DISCIPLINE");

    // The lead of MECH has no seat in ELEC, so ELEC's board is not found for them — never
    // "forbidden", which would confirm the department exists.
    await expect(
      createPost(leadActor, {
        kind: "BOARD",
        disciplineId: fixture.otherDisciplineId,
        body: "Not my department.",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(otherLeadActor.userId).not.toBe(leadActor.userId);
  });

  it("refuses an engineer every audience, even the ones they can read", async () => {
    await expect(
      createPost(fixture.engineerActor, { kind: "BOARD", body: "Can I post?" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createPost(fixture.engineerActor, {
        kind: "BOARD",
        projectId: fixture.projectId,
        body: "Can I post here?",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a post aimed at a project AND a department at once", async () => {
    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        projectId: fixture.projectId,
        disciplineId: fixture.disciplineId,
        body: "Both at once.",
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("the company's broadcast setting", () => {
  it("defaults to administrators and project managers", async () => {
    const audiences = await listAudiences(fixture.pmActor);
    expect(audiences.find((audience) => audience.kind === "EVERYONE")?.canPost).toBe(true);

    const leadAudiences = await listAudiences(leadActor);
    expect(leadAudiences.find((audience) => audience.kind === "EVERYONE")?.canPost).toBe(false);
  });

  it("ADMIN_ONLY shuts the company-wide board to everybody but an administrator", async () => {
    await setBroadcastPolicy(fixture.adminActor, { policy: "ADMIN_ONLY" });

    await expect(
      createPost(fixture.pmActor, { kind: "ANNOUNCEMENT", body: "Company-wide." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const post = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Company-wide.",
    });
    expect(post.audience.kind).toBe("EVERYONE");
  });

  it("ADMIN_PM_LEAD opens it to department leads as well", async () => {
    await setBroadcastPolicy(fixture.adminActor, { policy: "ADMIN_PM_LEAD" });

    const post = await createPost(leadActor, { kind: "ANNOUNCEMENT", body: "From a lead." });
    expect(post.audience.kind).toBe("EVERYONE");
    // An engineer is never in any of the three policies.
    await expect(
      createPost(fixture.engineerActor, { kind: "ANNOUNCEMENT", body: "From an engineer." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is an administrator's setting to change, and is audited", async () => {
    await expect(
      setBroadcastPolicy(fixture.pmActor, { policy: "ADMIN_PM_LEAD" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await setBroadcastPolicy(fixture.adminActor, { policy: "ADMIN_PM_LEAD" });
    const rows = await prisma.activityLog.findMany({
      where: { action: "BROADCAST_POLICY_CHANGED" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(fixture.orgId);
  });
});

describe("what each person can see", () => {
  it("gives everybody the company board, and only their own projects and departments", async () => {
    const engineerTabs = await listAudiences(fixture.engineerActor);
    expect(engineerTabs.map((tab) => tab.key)).toContain("everyone");
    expect(engineerTabs.map((tab) => tab.key)).toContain(`project:${fixture.projectId}`);
    expect(engineerTabs.map((tab) => tab.key)).toContain(`discipline:${fixture.disciplineId}`);
    expect(engineerTabs.map((tab) => tab.key)).not.toContain(
      `discipline:${fixture.otherDisciplineId}`,
    );

    // Somebody on no project sees the company board and nothing else.
    const outsiderTabs = await listAudiences(fixture.outsiderActor);
    expect(outsiderTabs.map((tab) => tab.key)).toEqual(["everyone"]);
  });

  it("hides a project board from a non-member, as not found", async () => {
    await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Members only.",
    });

    await expect(listBoard(fixture.outsiderActor, projectAudience())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const announcements = await listAnnouncementsForUser(fixture.outsiderActor);
    expect(announcements).toHaveLength(0);
  });

  it("keeps a project announcement out of a non-member's list but shows it to a member", async () => {
    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      title: "Site visit",
      body: "Thursday, 8am.",
    });

    const forMember = await listAnnouncementsForUser(fixture.engineerActor);
    expect(forMember.map((post) => post.title)).toEqual(["Site visit"]);
    expect(forMember[0]?.audience.label).toBeTruthy();

    const forOutsider = await listAnnouncementsForUser(fixture.outsiderActor);
    expect(forOutsider).toHaveLength(0);
  });

  it("shows a department announcement to that department only", async () => {
    await createPost(leadActor, {
      kind: "ANNOUNCEMENT",
      disciplineId: fixture.disciplineId,
      body: "Mechanical toolbox talk.",
    });

    // The fixture's engineer is in MECH; the other lead is in ELEC.
    expect(await listAnnouncementsForUser(fixture.engineerActor)).toHaveLength(1);
    expect(await listAnnouncementsForUser(otherLeadActor)).toHaveLength(0);

    // And the department's own board is a board only its own people can even open.
    await expect(
      listBoard(fixture.engineerActor, disciplineAudience(fixture.disciplineId)),
    ).resolves.toEqual([]);
    await expect(
      listBoard(otherLeadActor, disciplineAudience(fixture.disciplineId)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never shows another company's post", async () => {
    const rivalOrg = await makeOrg("Rival Engineering");
    const rival = await makeProjectFixture(rivalOrg.id);
    await createPost(rival.adminActor, { kind: "ANNOUNCEMENT", body: "Rival news." });

    expect(await listAnnouncementsForUser(fixture.adminActor)).toHaveLength(0);
    expect(await listBoard(fixture.adminActor, EVERYONE)).toHaveLength(0);
  });
});

describe("announcements stop showing when they should", () => {
  it("drops an expired one and keeps a running one", async () => {
    const running = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Still running.",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    // Expiry in the past is refused at the door, so an already-finished notice is made by moving
    // the row back — the same thing a week passing does.
    const expired = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Last week's notice.",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await prisma.post.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const list = await listAnnouncementsForUser(fixture.engineerActor);
    expect(list.map((post) => post.id)).toEqual([running.id]);
  });

  it("refuses an expiry in the past, and an expiry on a board post", async () => {
    await expect(
      createPost(fixture.adminActor, {
        kind: "ANNOUNCEMENT",
        body: "Already over.",
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        body: "Board posts do not expire.",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("dismissing is one person's own", () => {
  it("flags it for the person who dismissed it and nobody else", async () => {
    const post = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Everyone should read this.",
    });

    await dismissAnnouncement(fixture.engineerActor, { id: post.id });
    // Twice is fine — it is a preference, not a transaction.
    await dismissAnnouncement(fixture.engineerActor, { id: post.id });

    const forEngineer = await listAnnouncementsForUser(fixture.engineerActor);
    expect(forEngineer[0]?.dismissed).toBe(true);

    const forPm = await listAnnouncementsForUser(fixture.pmActor);
    expect(forPm[0]?.dismissed).toBe(false);

    // Personal read state writes no audit row — the documented deviation.
    const audit = await prisma.activityLog.findMany({ where: { entityId: post.id } });
    expect(audit.map((row) => row.action)).toEqual(["ANNOUNCEMENT_POSTED"]);
  });
});

describe("asking for an acknowledgement", () => {
  it("is an administrator's or a project manager's call, and a lead's never", async () => {
    const byAdmin = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Read and confirm.",
      requiresAck: true,
    });
    expect(byAdmin.requiresAck).toBe(true);

    const byPm = await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "Site rules changed.",
      requiresAck: true,
    });
    expect(byPm.requiresAck).toBe(true);

    // A department lead may post an announcement to their own department, and — under the widest
    // broadcast setting — to the whole company. Neither lets them demand a signature for it.
    await setBroadcastPolicy(fixture.adminActor, { policy: "ADMIN_PM_LEAD" });
    await expect(
      createPost(leadActor, {
        kind: "ANNOUNCEMENT",
        disciplineId: fixture.disciplineId,
        body: "Toolbox talk.",
        requiresAck: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createPost(leadActor, {
        kind: "ANNOUNCEMENT",
        body: "Company-wide, from a lead.",
        requiresAck: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The same announcement without the demand is still theirs to post.
    const plain = await createPost(leadActor, {
      kind: "ANNOUNCEMENT",
      disciplineId: fixture.disciplineId,
      body: "Toolbox talk.",
    });
    expect(plain.requiresAck).toBe(false);
  });

  it("belongs to announcements only, never a board post", async () => {
    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        body: "A board post cannot ask for a signature.",
        requiresAck: true,
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("leaves every other announcement exactly as it was", async () => {
    const plain = await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "News." });
    expect(plain.requiresAck).toBe(false);
    expect(plain.acked).toBe(false);
    expect(plain.ackedAt).toBeNull();
    expect(plain.ackProgress).toBeNull();
  });
});

describe("acknowledging", () => {
  const requiring = () =>
    createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Site access closures",
      body: "Gate 3 is shut this weekend.",
      requiresAck: true,
    });

  it("writes one row and one audit row, however many times it is pressed", async () => {
    const post = await requiring();

    const first = await acknowledgePost(fixture.engineerActor, { id: post.id });
    expect(first.acked).toBe(true);
    expect(first.ackedAt).not.toBeNull();

    // Pressing it again is the same acknowledgement, not a second one.
    const again = await acknowledgePost(fixture.engineerActor, { id: post.id });
    expect(again.acked).toBe(true);

    expect(await prisma.postAck.count({ where: { postId: post.id } })).toBe(1);

    // Unlike a dismissal, this IS company work: exactly one audit row records it.
    const audit = await prisma.activityLog.findMany({
      where: { entityId: post.id, action: "POST_ACKNOWLEDGED" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(fixture.engineerActor.userId);
  });

  it("is one person's own state and nobody else's", async () => {
    const post = await requiring();
    await acknowledgePost(fixture.engineerActor, { id: post.id });

    expect((await listAnnouncementsForUser(fixture.engineerActor))[0]?.acked).toBe(true);
    expect((await listAnnouncementsForUser(fixture.pmActor))[0]?.acked).toBe(false);
  });

  it("needs membership of the audience — a non-member is not found", async () => {
    const onProject = await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "For the project team.",
      requiresAck: true,
    });

    // Priya is in the company but not on this project, so the announcement is not found for her —
    // never "forbidden", which would confirm the id is real.
    await expect(
      acknowledgePost(fixture.outsiderActor, { id: onProject.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.postAck.count()).toBe(0);
  });

  it("is not found on an announcement that never asked for one, or on a removed one", async () => {
    const plain = await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "Just news." });
    await expect(acknowledgePost(fixture.engineerActor, { id: plain.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const removed = await requiring();
    await deletePost(fixture.adminActor, { id: removed.id });
    await expect(acknowledgePost(fixture.engineerActor, { id: removed.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("cannot be hidden from a dashboard until it has been acknowledged", async () => {
    const post = await requiring();

    await expect(
      dismissAnnouncement(fixture.engineerActor, { id: post.id }),
    ).rejects.toBeInstanceOf(ServiceError);

    await acknowledgePost(fixture.engineerActor, { id: post.id });
    await expect(dismissAnnouncement(fixture.engineerActor, { id: post.id })).resolves.toEqual({
      dismissed: true,
    });

    // An announcement that asks for nothing is dismissible as it always was.
    const plain = await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "News." });
    await expect(dismissAnnouncement(fixture.engineerActor, { id: plain.id })).resolves.toEqual({
      dismissed: true,
    });
  });
});

describe("who has acknowledged, and who is told", () => {
  it("shows the count and the names to the author and an administrator, and to nobody else", async () => {
    // Posted by the project manager, to their project: the audience is its three members.
    const post = await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "Please confirm you have read the new site rules.",
      requiresAck: true,
    });
    await acknowledgePost(fixture.engineerActor, { id: post.id });

    // The fixture's project has five internal members: the administrator, the manager, the
    // engineer and the two department leads this suite adds.
    const forAuthor = (await listAnnouncementsForUser(fixture.pmActor))[0];
    expect(forAuthor?.ackProgress?.audienceCount).toBe(5);
    expect(forAuthor?.ackProgress?.ackCount).toBe(1);
    expect(forAuthor?.ackProgress?.outstandingTotal).toBe(4);
    expect(forAuthor?.ackProgress?.outstandingNames).not.toContain("John Carter");

    // An administrator of this company may see it too.
    expect((await listAnnouncementsForUser(fixture.adminActor))[0]?.ackProgress).not.toBeNull();

    // A colleague in the same audience is told their own state and nothing about anybody else's.
    const forReader = (await listAnnouncementsForUser(fixture.engineerActor))[0];
    expect(forReader?.acked).toBe(true);
    expect(forReader?.ackProgress).toBeNull();
  });

  it("never counts a contractor, even one working on that very project", async () => {
    const contractor = await makeExternal();

    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "For the internal team.",
      requiresAck: true,
    });

    const forAuthor = (await listAnnouncementsForUser(fixture.pmActor))[0];
    // Six members on the project now; the contractor is not one of the five who were told.
    expect(forAuthor?.ackProgress?.audienceCount).toBe(5);
    expect(forAuthor?.ackProgress?.outstandingNames).not.toContain("Idris Contractor");
    expect(contractor.userId).toBeTruthy();
  });

  it("caps the outstanding list at twenty and still says the true total", async () => {
    // Twenty-two more colleagues, so the company-wide audience is well past the cap.
    for (let index = 0; index < 22; index += 1) {
      await makeUser({
        name: `Colleague ${String(index).padStart(2, "0")}`,
        role: "ENGINEER",
        orgId: fixture.orgId,
      });
    }

    const post = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Everybody, please confirm.",
      requiresAck: true,
    });
    await acknowledgePost(fixture.engineerActor, { id: post.id });

    const forAuthor = (await listAnnouncementsForUser(fixture.adminActor))[0];
    // Six people in the fixture plus the twenty-two above.
    expect(forAuthor?.ackProgress?.audienceCount).toBe(28);
    expect(forAuthor?.ackProgress?.ackCount).toBe(1);
    expect(forAuthor?.ackProgress?.outstandingTotal).toBe(27);
    expect(forAuthor?.ackProgress?.outstandingNames).toHaveLength(20);
  });

  it("never leaks who acknowledged through the activity feeds", async () => {
    const post = await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "Please confirm you have read the new site rules.",
      requiresAck: true,
    });
    await acknowledgePost(fixture.engineerActor, { id: post.id });

    // The audit row exists — acknowledging IS company work — but it is written unprojected and
    // name-free, so neither project feed can carry it. A colleague reading the project's history
    // would otherwise learn exactly what `ackProgress` refuses to tell them.
    const row = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: post.id, action: "POST_ACKNOWLEDGED" },
    });
    expect(row.projectId).toBeNull();
    expect(row.summary).not.toContain(fixture.engineerActor.name);
    // Who did it is still on the row, where the audit trail keeps it.
    expect(row.actorId).toBe(fixture.engineerActor.userId);

    // The project's own feed, read by a plain member of it.
    const feed = await listActivity(leadActor, { projectId: fixture.projectId });
    expect(feed.some((item) => item.action === "POST_ACKNOWLEDGED")).toBe(false);
    expect(feed.some((item) => item.summary.includes(fixture.engineerActor.name))).toBe(false);

    // And the dashboard's recent-activity strip, which reads the same rows by project.
    const dashboard = await getDashboardForActor(leadActor);
    expect(dashboard.recentActivity.some((item) => item.action === "POST_ACKNOWLEDGED")).toBe(
      false,
    );
  });
});

describe("replies are one level deep", () => {
  it("accepts a reply on a root board post and refuses a reply to a reply", async () => {
    const root = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Anyone got the survey drawings?",
    });

    // Anybody who can read the board can join the conversation on it.
    const reply = await replyToPost(fixture.engineerActor, {
      parentId: root.id,
      body: "Sent them over.",
    });
    expect(reply.parentId).toBe(root.id);
    expect(reply.audience.key).toBe(`project:${fixture.projectId}`);

    await expect(
      replyToPost(fixture.pmActor, { parentId: reply.id, body: "Thanks." }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses a reply on an announcement", async () => {
    const announcement = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Read only.",
    });
    await expect(
      replyToPost(fixture.engineerActor, { parentId: announcement.id, body: "Comment?" }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("lists roots newest first with their replies oldest first", async () => {
    const first = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "First.",
    });
    const second = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Second.",
    });
    await replyToPost(fixture.engineerActor, { parentId: first.id, body: "Reply one." });
    await replyToPost(fixture.engineerActor, { parentId: first.id, body: "Reply two." });

    const board = await listBoard(fixture.engineerActor, projectAudience());
    expect(board.map((post) => post.id)).toEqual([second.id, first.id]);
    expect(board[1]?.replies.map((reply) => reply.body)).toEqual(["Reply one.", "Reply two."]);
  });
});

describe("editing, removing and moderating", () => {
  it("lets the author edit and refuses everybody else but an administrator", async () => {
    const post = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Typo here.",
    });

    const edited = await editPost(fixture.pmActor, { id: post.id, body: "Fixed." });
    expect(edited.body).toBe("Fixed.");
    expect(edited.editedAt).not.toBeNull();

    await expect(
      editPost(fixture.engineerActor, { id: post.id, body: "Not mine." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      editPost(fixture.adminActor, { id: post.id, body: "Administrator's correction." }),
    ).resolves.toBeTruthy();
  });

  it("leaves a tombstone rather than dropping the post, so its replies still read", async () => {
    const root = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Original question.",
    });
    await replyToPost(fixture.engineerActor, { parentId: root.id, body: "An answer." });

    await deletePost(fixture.pmActor, { id: root.id });

    const board = await listBoard(fixture.engineerActor, projectAudience());
    expect(board).toHaveLength(1);
    expect(board[0]?.isDeleted).toBe(true);
    expect(board[0]?.body).toBe("Post removed");
    expect(board[0]?.replies).toHaveLength(1);
    // The row itself is still there — soft delete, exactly like a comment.
    expect(await prisma.post.count({ where: { id: root.id } })).toBe(1);
  });

  it("lets a project manager moderate their project board and nobody moderate Everyone but an admin", async () => {
    const onProject = await createPost(fixture.adminActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Admin's project post.",
    });
    await expect(deletePost(fixture.pmActor, { id: onProject.id })).resolves.toEqual({
      removed: true,
    });

    const companyWide = await createPost(fixture.adminActor, {
      kind: "BOARD",
      body: "Admin's company post.",
    });
    await expect(deletePost(fixture.pmActor, { id: companyWide.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(deletePost(fixture.adminActor, { id: companyWide.id })).resolves.toEqual({
      removed: true,
    });
  });
});

describe("notifications", () => {
  it("tells the audience about an announcement and leaves contractors out", async () => {
    const contractor = await makeExternal();

    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "New safety briefing",
      body: "Everyone on site from Monday.",
    });

    const rows = await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT" } });
    const told = rows.map((row) => row.userId);
    expect(told).toContain(fixture.engineerActor.userId);
    expect(told).toContain(fixture.pmActor.userId);
    // The author never hears about their own post, and a contractor never hears about any of it.
    expect(told).not.toContain(fixture.adminActor.userId);
    expect(told).not.toContain(contractor.userId);
    expect(rows[0]?.linkUrl).toBe("/messages?tab=everyone");
  });

  it("says nothing for a board post, and tells only the author about a reply", async () => {
    const root = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Board posts are quiet.",
    });
    expect(await prisma.notification.count()).toBe(0);

    await replyToPost(fixture.engineerActor, { parentId: root.id, body: "Replying." });
    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(fixture.pmActor.userId);
    // A reply borrows COMMENT_ADDED, which maps to no chat toggle and so stays in the app.
    expect(rows[0]?.type).toBe("COMMENT_ADDED");
  });
});

describe("a contractor has no noticeboard at all", () => {
  it("answers not found to every read and every write", async () => {
    const contractor = await makeExternal();
    const post = await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "For the team.",
    });

    await expect(listAudiences(contractor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAnnouncementsForUser(contractor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listBoard(contractor, EVERYONE)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listBoard(contractor, projectAudience())).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createPost(contractor, { kind: "BOARD", projectId: fixture.projectId, body: "Hello?" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      replyToPost(contractor, { parentId: post.id, body: "Hello?" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(dismissAnnouncement(contractor, { id: post.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("leaves their daily brief working, with no announcements in it", async () => {
    const contractor = await makeExternal();
    await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "Company news." });

    const brief = await personBrief(contractor);
    expect(brief.announcements.total).toBe(0);
  });
});

describe("the daily brief", () => {
  it("carries the announcements running for that person's audiences", async () => {
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Company news",
      body: "Everybody.",
    });
    await createPost(leadActor, {
      kind: "ANNOUNCEMENT",
      disciplineId: fixture.disciplineId,
      body: "Mechanical only.",
    });

    const forEngineer = await personBrief(fixture.engineerActor);
    expect(forEngineer.announcements.total).toBe(2);
    expect(forEngineer.announcements.items.map((item) => item.projectCode)).toContain("Everyone");

    // The PM has no discipline, so they get the company one only.
    const forPm = await personBrief(fixture.pmActor);
    expect(forPm.announcements.total).toBe(1);
  });
});

describe("audience labels come back with the post", () => {
  it("names the company, the project code and the discipline", async () => {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: fixture.projectId },
      select: { code: true },
    });
    const discipline = await prisma.discipline.findUniqueOrThrow({
      where: { id: fixture.disciplineId },
      select: { name: true, colorHex: true },
    });

    const everyone = await createPost(fixture.adminActor, { kind: "BOARD", body: "1" });
    const onProject = await createPost(fixture.adminActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "2",
    });
    const onDiscipline = await createPost(fixture.adminActor, {
      kind: "BOARD",
      disciplineId: fixture.disciplineId,
      body: "3",
    });

    expect(everyone.audience.label).toBe("Everyone");
    expect(onProject.audience.label).toBe(project.code);
    expect(onDiscipline.audience.label).toBe(discipline.name);
    expect(onDiscipline.audience.colorHex).toBe(discipline.colorHex);
  });
});

/* ------------------------------------------------------------------ */
/* Attaching a document to a board post                                */
/* ------------------------------------------------------------------ */

describe("a board post can point at one document", () => {
  it("attaches a document on a PROJECT board and shows it as a chip", async () => {
    const document = await makeDocument(fixture.projectId, "Vendor datasheet");

    const post = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "The datasheet everyone keeps asking for.",
      documentId: document.id,
    });
    expect(post.id).toBeTruthy();

    const board = await listBoard(fixture.engineerActor, projectAudience());
    expect(board).toHaveLength(1);
    expect(board[0]?.attachment).toEqual({
      id: document.id,
      title: "Vendor datasheet",
      revision: 1,
      linkUrl: `/projects/${fixture.projectId}`,
    });
  });

  it("refuses one on the company-wide board, on a department board, and on an announcement", async () => {
    const document = await makeDocument(fixture.projectId, "Vendor datasheet");

    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        body: "Company-wide with a file?",
        documentId: document.id,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        disciplineId: fixture.disciplineId,
        body: "Department board with a file?",
        documentId: document.id,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    await expect(
      createPost(fixture.adminActor, {
        kind: "ANNOUNCEMENT",
        projectId: fixture.projectId,
        body: "Announcement with a file?",
        documentId: document.id,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await prisma.post.count()).toBe(0);
  });

  it("never lets a reply carry one", async () => {
    const document = await makeDocument(fixture.projectId, "Vendor datasheet");
    const root = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Root post.",
      documentId: document.id,
    });
    await replyToPost(fixture.engineerActor, { parentId: root.id, body: "Noted." });

    const board = await listBoard(fixture.engineerActor, projectAudience());
    expect(board[0]?.attachment).not.toBeNull();
    // A reply is a plain PostDTO: there is no attachment field on it at all, so there is nothing
    // for a screen to draw and nothing for the input to smuggle in.
    expect(board[0]?.replies).toHaveLength(1);
    expect("attachment" in (board[0]?.replies[0] as object)).toBe(false);
    expect(await prisma.post.findFirst({ where: { parentId: root.id } })).toMatchObject({
      documentId: null,
    });
  });

  it("says not found for a document on a different project", async () => {
    const other = await prisma.project.create({
      data: {
        orgId: fixture.orgId,
        name: "Second project",
        code: `SEC-${Math.floor(Math.random() * 1_000_000)}`,
        description: "Same company, different project.",
        createdById: fixture.adminActor.userId,
        members: { create: [{ userId: fixture.adminActor.userId, projectRole: "ADMIN" }] },
      },
    });
    const elsewhere = await makeDocument(other.id, "Somebody else's datasheet");

    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        projectId: fixture.projectId,
        body: "Wrong project's file.",
        documentId: elsewhere.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("says not found for a document that does not exist", async () => {
    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        projectId: fixture.projectId,
        body: "Made-up id.",
        documentId: "ckzzzzzzzzzzzzzzzzzzzzzzz",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("drops the chip when the document is removed, and still shows the post", async () => {
    const document = await makeDocument(fixture.projectId, "Vendor datasheet");
    await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Still worth reading without the file.",
      documentId: document.id,
    });

    await prisma.document.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });

    const board = await listBoard(fixture.engineerActor, projectAudience());
    expect(board).toHaveLength(1);
    expect(board[0]?.body).toBe("Still worth reading without the file.");
    // No teaser, no title, no placeholder — the chip simply is not there.
    expect(board[0]?.attachment).toBeNull();
    // The post still points at it in the database; only the READ decided not to show it.
    expect(await prisma.post.findFirst({ where: { id: board[0]?.id } })).toMatchObject({
      documentId: document.id,
    });
  });

  it("drops the chip with the post when the post itself is removed", async () => {
    const document = await makeDocument(fixture.projectId, "Vendor datasheet");
    const post = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "About to go.",
      documentId: document.id,
    });
    await deletePost(fixture.pmActor, { id: post.id });

    const board = await listBoard(fixture.engineerActor, projectAudience());
    expect(board[0]?.isDeleted).toBe(true);
    expect(board[0]?.attachment).toBeNull();
  });

  it("keeps a contractor out of boards entirely, attachment or not", async () => {
    const contractor = await makeExternal();
    const document = await makeDocument(fixture.projectId, "Vendor datasheet");
    await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "Team only.",
      documentId: document.id,
    });

    await expect(listBoard(contractor, projectAudience())).rejects.toBeInstanceOf(NotFoundError);
  });
});

/* ------------------------------------------------------------------ */
/* Announcements that include contractors                              */
/* ------------------------------------------------------------------ */

describe("an announcement can include contractors", () => {
  it("reaches the company's contractors on a company-wide notice, and points them at their own page", async () => {
    const contractor = await makeExternal();

    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Site access closures this weekend",
      body: "Gate 3 will be shut Sat–Sun for repaving.",
      includeExternals: true,
    });

    const rows = await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT" } });
    const told = rows.map((row) => row.userId);
    expect(told).toContain(contractor.userId);
    expect(told).toContain(fixture.engineerActor.userId);

    // Colleagues go to the noticeboard; a contractor goes to the one page they may read.
    const theirs = rows.find((row) => row.userId === contractor.userId);
    expect(theirs?.linkUrl).toBe("/my-tasks/brief");
    const colleague = rows.find((row) => row.userId === fixture.engineerActor.userId);
    expect(colleague?.linkUrl).toBe("/messages?tab=everyone");
  });

  it("reaches only the contractors holding live work on an included project notice", async () => {
    const working = await makeExternal();
    await giveWorkOn(working, fixture.projectId);

    // A second contractor: a member of the project on paper, with nothing live on it.
    const idle = await makeExternal();

    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "Scaffold coming down Thursday.",
      includeExternals: true,
    });

    const told = (await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT" } })).map(
      (row) => row.userId,
    );
    expect(told).toContain(working.userId);
    expect(told).not.toContain(idle.userId);
  });

  it("changes nothing at all while the flag is off", async () => {
    const contractor = await makeExternal();
    await giveWorkOn(contractor, fixture.projectId);

    await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "Company news." });
    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "Project news.",
      includeExternals: false,
    });

    const told = (await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT" } })).map(
      (row) => row.userId,
    );
    expect(told).not.toContain(contractor.userId);
    expect((await personBrief(contractor)).announcements.total).toBe(0);
  });

  it("refuses the flag on a department announcement and on any board post", async () => {
    await expect(
      createPost(leadActor, {
        kind: "ANNOUNCEMENT",
        disciplineId: fixture.disciplineId,
        body: "Mechanical only.",
        includeExternals: true,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    await expect(
      createPost(fixture.adminActor, {
        kind: "BOARD",
        projectId: fixture.projectId,
        body: "A board reaches nobody.",
        includeExternals: true,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await prisma.post.count()).toBe(0);
  });

  it("lists exactly the included, still-running notices on a contractor's brief", async () => {
    const contractor = await makeExternal();
    await giveWorkOn(contractor, fixture.projectId);

    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Included company notice",
      body: "Gate 3 will be shut Sat–Sun for repaving.",
      includeExternals: true,
    });
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Ordinary company notice",
      body: "Not for contractors.",
    });
    await createPost(leadActor, {
      kind: "ANNOUNCEMENT",
      disciplineId: fixture.disciplineId,
      title: "Department notice",
      body: "Never reaches a contractor.",
    });
    // Included, but already finished.
    const expired = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Old included notice",
      body: "Over and done with.",
      includeExternals: true,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await prisma.post.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const brief = await personBrief(contractor);
    expect(brief.announcements.total).toBe(1);
    const only = brief.announcements.items[0];
    expect(only?.title).toBe("Included company notice");
    // Title, body, who posted it, and when — and nowhere to click, because there is nowhere they
    // may go.
    expect(only?.body).toBe("Gate 3 will be shut Sat–Sun for repaving.");
    expect(only?.note).toBe(`Posted by ${fixture.adminActor.name}`);
    expect(only?.at).toBeInstanceOf(Date);
    expect(only?.linkUrl).toBe("");
    // Still nothing to acknowledge, ever.
    expect(brief.awaitingAcknowledgement.total).toBe(0);
  });

  it("only shows a project notice to a contractor while the work is live", async () => {
    const contractor = await makeExternal();
    const taskId = await giveWorkOn(contractor, fixture.projectId);

    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      title: "Scaffold coming down",
      body: "Thursday morning.",
      includeExternals: true,
    });
    expect((await personBrief(contractor)).announcements.total).toBe(1);

    // The work goes away, and so does the project — the same narrowing every external read takes.
    await prisma.disciplineTask.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });
    expect((await personBrief(contractor)).announcements.total).toBe(0);
  });

  it("never counts a contractor in an acknowledgement total, even on a notice that included them", async () => {
    const contractor = await makeExternal();
    await giveWorkOn(contractor, fixture.projectId);

    const post = await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      title: "Please confirm",
      body: "Read and confirm before Friday.",
      requiresAck: true,
      includeExternals: true,
    });

    const internalMembers = await prisma.projectMember.count({
      where: { projectId: fixture.projectId, user: { role: { not: "EXTERNAL" }, isActive: true } },
    });

    const seenByAuthor = (await listAnnouncementsForUser(fixture.pmActor)).find(
      (item) => item.id === post.id,
    );
    expect(seenByAuthor?.ackProgress?.audienceCount).toBe(internalMembers);
    expect(seenByAuthor?.ackProgress?.outstandingNames).not.toContain(contractor.name);

    // And the contractor is never offered the button: not on their brief, and not through the door.
    const theirBrief = await personBrief(contractor);
    expect(theirBrief.announcements.items[0]?.title).toBe("Please confirm");
    expect(theirBrief.awaitingAcknowledgement.total).toBe(0);
    await expect(acknowledgePost(contractor, { id: post.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
