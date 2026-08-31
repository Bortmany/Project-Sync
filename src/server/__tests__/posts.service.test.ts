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
import {
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
