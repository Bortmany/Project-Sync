// "Add a member" adds someone NEW, and only that — proved against DATABASE_URL_TEST.
//
// Before this rule the Team tab's Add a member wrote through `upsertMember`, so picking somebody
// already on the project quietly overwrote their role and discipline (an Electrical engineer became
// Mechanical with no warning), and a crafted request could turn the project manager into an
// engineer the same way. `addMember` refuses anyone already on the project, leaves their row
// exactly as it was, and points at the Members list — the one deliberate place a role is changed.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { actorForUser } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { ALREADY_ON_PROJECT, addMember, upsertMember } from "@/server/services/projects";
import {
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  type Fixture,
} from "@/server/__tests__/harness";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function memberRow(userId: string) {
  return prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: fixture.projectId, userId } },
    select: { projectRole: true, disciplineId: true },
  });
}

async function refusalOf(work: Promise<unknown>): Promise<ServiceError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ServiceError);
  return error as ServiceError;
}

describe("addMember adds someone new", () => {
  it("adds a person who is not on the project yet, and records it", async () => {
    const member = await addMember(fixture.pmActor, {
      projectId: fixture.projectId,
      userId: fixture.outsiderActor.userId,
      projectRole: "ENGINEER",
      disciplineId: fixture.otherDisciplineId,
    });

    expect(member.projectRole).toBe("ENGINEER");
    expect(member.disciplineId).toBe(fixture.otherDisciplineId);
    const logged = await prisma.activityLog.findFirst({
      where: { projectId: fixture.projectId, entityType: "ProjectMember", entityId: member.id },
    });
    expect(logged?.action).toBe("MEMBER_ADDED");
  });
});

describe("addMember never changes somebody already on the project", () => {
  it("refuses to move an engineer to another discipline, and leaves their row alone", async () => {
    // The reported case: an engineer in one discipline, "added" again in another.
    const before = await memberRow(fixture.engineerActor.userId);

    const refusal = await refusalOf(
      addMember(fixture.adminActor, {
        projectId: fixture.projectId,
        userId: fixture.engineerActor.userId,
        projectRole: "ENGINEER",
        disciplineId: fixture.otherDisciplineId,
      }),
    );

    expect(refusal.fieldErrors?.userId).toEqual([ALREADY_ON_PROJECT]);
    expect(refusal.message).toContain("already on this project");
    expect(await memberRow(fixture.engineerActor.userId)).toEqual(before);
  });

  it("refuses to downgrade the project manager to an engineer by a crafted request", async () => {
    const before = await memberRow(fixture.pmActor.userId);
    expect(before?.projectRole).toBe("PROJECT_MANAGER");

    // Sent by an administrator — the most powerful person there is — and by the PM themselves.
    for (const actor of [fixture.adminActor, fixture.pmActor]) {
      const refusal = await refusalOf(
        addMember(actor, {
          projectId: fixture.projectId,
          userId: fixture.pmActor.userId,
          projectRole: "ENGINEER",
          disciplineId: fixture.disciplineId,
        }),
      );
      expect(refusal.fieldErrors?.userId).toEqual([ALREADY_ON_PROJECT]);
    }

    expect(await memberRow(fixture.pmActor.userId)).toEqual(before);
    const changes = await prisma.activityLog.count({
      where: { projectId: fixture.projectId, action: "MEMBER_UPDATED" },
    });
    expect(changes).toBe(0);
  });

  it("refuses even an identical re-add, so nothing is written or logged twice", async () => {
    await refusalOf(
      addMember(fixture.adminActor, {
        projectId: fixture.projectId,
        userId: fixture.engineerActor.userId,
        projectRole: "ENGINEER",
        disciplineId: fixture.disciplineId,
      }),
    );
    const logged = await prisma.activityLog.count({ where: { projectId: fixture.projectId } });
    expect(logged).toBe(0);
  });

  it("still lets a role be changed the deliberate way, from the Members list", async () => {
    const changed = await upsertMember(fixture.adminActor, {
      projectId: fixture.projectId,
      userId: fixture.engineerActor.userId,
      projectRole: "DISCIPLINE_LEAD",
      disciplineId: fixture.disciplineId,
    });
    expect(changed.projectRole).toBe("DISCIPLINE_LEAD");
  });
});

describe("addMember keeps its other walls", () => {
  it("refuses an engineer, who may not manage members", async () => {
    await expect(
      addMember(fixture.engineerActor, {
        projectId: fixture.projectId,
        userId: fixture.outsiderActor.userId,
        projectRole: "ENGINEER",
        disciplineId: fixture.disciplineId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not find another company's project, nor add another company's person", async () => {
    const other = await makeOrg("Other Company");
    const otherFixture = await makeProjectFixture(other.id);
    const stranger = await makeUser({ name: "Stranger Person", role: "ENGINEER", orgId: other.id });

    await expect(
      addMember(otherFixture.adminActor, {
        projectId: fixture.projectId,
        userId: stranger.id,
        projectRole: "ENGINEER",
        disciplineId: otherFixture.disciplineId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      addMember(fixture.adminActor, {
        projectId: fixture.projectId,
        userId: stranger.id,
        projectRole: "ENGINEER",
        disciplineId: fixture.disciplineId,
      }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(await memberRow(stranger.id)).toBeNull();

    // An outsider admin cannot learn whether somebody is on our project either: "not found" first.
    const outsiderAdmin = await actorForUser(otherFixture.adminActor.userId);
    await expect(
      addMember(outsiderAdmin, {
        projectId: fixture.projectId,
        userId: fixture.pmActor.userId,
        projectRole: "ENGINEER",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
