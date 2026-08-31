// Seed: a second, deliberately smaller demo company — Northbay Construction.
//
// It exists for two reasons. First, it shows the same product running an entirely different
// industry: its disciplines and its stage gates come from the CONSTRUCTION template, not from any
// wording in this file. Second, it is a real second tenant, so the tenant rule can be proved rather
// than asserted — a Meridian person resolves none of this company's work (prisma/seed-check.ts).
//
// Everything after the people goes through the SERVICE layer, exactly as the Meridian seed does, so
// the audit trail, the derived progress and the stage gates are all genuine. Safe to run again: it
// stops if the demo project is already there, and SEED_RESET=1 rebuilds it from scratch.

import { prisma } from "@/lib/db";
import { phaseLockedFor, sortPhases } from "@/lib/phase-lock";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { RoleName, TaskStatusName } from "@/lib/zod-schemas";
import { actorForUser, type ActorContext } from "@/server/actor";
import { disciplinesForTemplate } from "@/server/industry-templates";
import { createComment } from "@/server/services/comments";
import { createPost } from "@/server/services/posts";
import { createProject } from "@/server/services/projects";
import {
  completeDisciplineTask,
  createMainTask,
  setMainTaskPhase,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";
import { makePdf, makeUploader } from "./seed-documents";

export const NORTHBAY_ORG_NAME = "Northbay Construction";
export const NORTHBAY_ORG_SLUG = "northbay-construction";
export const NORTHBAY_TEMPLATE = "CONSTRUCTION";
export const NORTHBAY_ADMIN_EMAIL = "nora.hadid@tielora.example";
export const NORTHBAY_PROJECT_CODE = "HT-P2";

type Person = {
  email: string;
  name: string;
  role: RoleName;
  discipline: string | null;
  jobTitle: string;
};

const PEOPLE: Person[] = [
  { email: "tariq.almamari@tielora.example", name: "Tariq al-Mamari", role: "PROJECT_MANAGER", discipline: null, jobTitle: "Project manager" },
  { email: "hana.suleiman@tielora.example", name: "Hana Suleiman", role: "DISCIPLINE_LEAD", discipline: "STRUCT", jobTitle: "Structural lead" },
  { email: "peter.novak@tielora.example", name: "Peter Novak", role: "DISCIPLINE_LEAD", discipline: "MEP", jobTitle: "MEP lead" },
  { email: "noor.alaraimi@tielora.example", name: "Noor al-Araimi", role: "ENGINEER", discipline: "STRUCT", jobTitle: "Structural engineer" },
];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const out = (line: string) => process.stdout.write(`${line}\n`);

type SeedSubtask = {
  discipline: string;
  title: string;
  assignee: string;
  deadline: string;
  end?: TaskStatusName;
};

type SeedMainTask = {
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  startDate: string;
  deadline: string;
  owner: string;
  phase: string;
  subtasks: SeedSubtask[];
};

const WORK: SeedMainTask[] = [
  {
    title: "Podium Structure Design Package",
    description:
      "Issue the podium structure package for construction: frame analysis, rebar schedules and the services coordination that goes with them.",
    priority: "HIGH",
    startDate: "2026-05-04",
    deadline: "2026-09-25",
    owner: "tariq.almamari@tielora.example",
    phase: "Design",
    subtasks: [
      { discipline: "STRUCT", title: "Podium frame analysis reissued", assignee: "hana.suleiman@tielora.example", deadline: "2026-08-14", end: "COMPLETED" },
      { discipline: "MEP", title: "Riser routing coordinated with the frame", assignee: "peter.novak@tielora.example", deadline: "2026-08-20", end: "COMPLETED" },
      { discipline: "STRUCT", title: "Rebar schedules checked", assignee: "noor.alaraimi@tielora.example", deadline: "2026-09-18", end: "IN_PROGRESS" },
      { discipline: "QAQC", title: "Design QA check sheet closed", assignee: "tariq.almamari@tielora.example", deadline: "2026-09-22" },
    ],
  },
  {
    title: "Level 12 Slab Pour Readiness",
    description:
      "Everything that has to be in place before the level 12 slab is poured: drawings, cast-in items, the pre-pour checklist and the setting-out survey.",
    priority: "CRITICAL",
    startDate: "2026-07-01",
    deadline: "2026-10-30",
    owner: "tariq.almamari@tielora.example",
    phase: "Structure",
    subtasks: [
      { discipline: "STRUCT", title: "Slab reinforcement drawings issued", assignee: "hana.suleiman@tielora.example", deadline: "2026-08-10", end: "COMPLETED" },
      { discipline: "MEP", title: "Cast-in sleeves marked up", assignee: "peter.novak@tielora.example", deadline: "2026-09-30", end: "IN_PROGRESS" },
      // Its deadline has passed and it is not finished, so it reads as overdue — derived, never stored.
      { discipline: "QAQC", title: "Pre-pour inspection checklist agreed", assignee: "tariq.almamari@tielora.example", deadline: "2026-08-12", end: "IN_PROGRESS" },
      { discipline: "SURV", title: "Setting-out survey for level 12", assignee: "noor.alaraimi@tielora.example", deadline: "2026-10-05" },
    ],
  },
];

export type SeedNorthbayContext = {
  /** The shared demo password, already hashed once by prisma/seed.ts. */
  passwordHash: string;
};

/** Builds (or rebuilds) the Northbay demo company. Idempotent, like the Meridian seed. */
export async function seedNorthbay(ctx: SeedNorthbayContext): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: NORTHBAY_ORG_SLUG },
    update: { name: NORTHBAY_ORG_NAME },
    create: { name: NORTHBAY_ORG_NAME, slug: NORTHBAY_ORG_SLUG, industryTemplate: NORTHBAY_TEMPLATE },
    select: { id: true },
  });

  // The disciplines are the CONSTRUCTION template's own, read from src/server/industry-templates.ts
  // — the same list a construction company signing up at /signup gets on day one.
  const disciplineIdByCode = new Map<string, string>();
  for (const discipline of disciplinesForTemplate("CONSTRUCTION")) {
    const row = await prisma.discipline.upsert({
      where: { orgId_code: { orgId: org.id, code: discipline.code } },
      update: { name: discipline.name, colorHex: discipline.colorHex, sortOrder: discipline.sortOrder },
      create: { ...discipline, orgId: org.id },
    });
    disciplineIdByCode.set(row.code, row.id);
  }

  const userIdByEmail = new Map<string, string>();
  const admin = await prisma.user.upsert({
    where: { email: NORTHBAY_ADMIN_EMAIL },
    update: { name: "Nora Hadid", role: "ADMIN", isActive: true },
    create: {
      orgId: org.id,
      email: NORTHBAY_ADMIN_EMAIL,
      name: "Nora Hadid",
      passwordHash: ctx.passwordHash,
      role: "ADMIN",
      jobTitle: "Administrator",
    },
  });
  userIdByEmail.set(admin.email, admin.id);

  for (const person of PEOPLE) {
    const disciplineId = person.discipline ? (disciplineIdByCode.get(person.discipline) as string) : null;
    const row = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, role: person.role, disciplineId, jobTitle: person.jobTitle, isActive: true },
      create: {
        orgId: org.id,
        email: person.email,
        name: person.name,
        passwordHash: ctx.passwordHash,
        role: person.role,
        disciplineId,
        jobTitle: person.jobTitle,
      },
    });
    userIdByEmail.set(row.email, row.id);
  }

  const existing = await prisma.project.findUnique({
    where: { orgId_code: { orgId: org.id, code: NORTHBAY_PROJECT_CODE } },
  });
  if (existing && process.env.SEED_RESET !== "1") {
    out(`The ${NORTHBAY_ORG_NAME} demo project ${NORTHBAY_PROJECT_CODE} is already here, so nothing was rebuilt.`);
    return;
  }
  if (existing) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SEED_RESET deletes audit and document history and is refused in production.");
    }
    await resetNorthbayProject(org.id, existing.id);
  }

  const actors = new Map<string, ActorContext>();
  const actorFor = async (email: string): Promise<ActorContext> => {
    const cached = actors.get(email);
    if (cached) return cached;
    const actor = await actorForUser(userIdByEmail.get(email) as string);
    actors.set(email, actor);
    return actor;
  };
  const adminActor = await actorFor(NORTHBAY_ADMIN_EMAIL);

  const project = await createProject(adminActor, {
    name: "Harbor Tower — Phase 2",
    code: NORTHBAY_PROJECT_CODE,
    description:
      "The second phase of the Harbor Tower development: the podium structure, the tower core to " +
      "level 20 and the associated services coordination.",
    startDate: day("2026-05-01"),
    targetDate: day("2027-06-30"),
    disciplineIds: [...disciplineIdByCode.values()],
    members: [
      { userId: admin.id, projectRole: "ADMIN", disciplineId: null },
      ...PEOPLE.map((person) => ({
        userId: userIdByEmail.get(person.email) as string,
        projectRole: person.role,
        disciplineId: person.discipline ? (disciplineIdByCode.get(person.discipline) as string) : null,
      })),
    ],
  });

  for (const person of PEOPLE.filter((candidate) => candidate.role === "DISCIPLINE_LEAD")) {
    await prisma.projectDiscipline.update({
      where: {
        projectId_disciplineId: {
          projectId: project.id,
          disciplineId: disciplineIdByCode.get(person.discipline as string) as string,
        },
      },
      data: { leadId: userIdByEmail.get(person.email) as string },
    });
  }

  for (const work of WORK) {
    const mainTask = await createMainTask(adminActor, {
      projectId: project.id,
      title: work.title,
      description: work.description,
      priority: work.priority,
      startDate: day(work.startDate),
      deadline: day(work.deadline),
      ownerId: userIdByEmail.get(work.owner) as string,
      disciplineTasks: work.subtasks.map((subtask) => ({
        disciplineId: disciplineIdByCode.get(subtask.discipline) as string,
        title: subtask.title,
        description: undefined,
        assigneeId: userIdByEmail.get(subtask.assignee) as string,
        deadline: day(subtask.deadline),
        isMandatory: true,
        requiredDocuments: [],
      })),
    });

    const created = await prisma.disciplineTask.findMany({
      where: { mainTaskId: mainTask.id },
      select: { id: true, title: true },
    });
    const idByTitle = new Map(created.map((task) => [task.title, task.id]));

    for (const subtask of work.subtasks) {
      if (!subtask.end) continue;
      const actor = await actorFor(subtask.assignee);
      const taskId = idByTitle.get(subtask.title) as string;
      if (subtask.end === "COMPLETED") {
        await completeDisciplineTask(actor, { id: taskId });
      } else {
        await updateDisciplineTaskStatus(actor, { id: taskId, status: subtask.end });
      }
    }
  }

  // The gates go on last, exactly as they do on the Meridian project: a locked phase would (rightly)
  // refuse the very completions above. Design is unfinished, so everything after it is shut.
  const phaseIdByName = new Map(
    (await prisma.projectPhase.findMany({ where: { projectId: project.id } })).map((phase) => [
      phase.name,
      phase.id,
    ]),
  );
  for (const work of WORK) {
    const mainTask = await prisma.mainTask.findFirstOrThrow({
      where: { projectId: project.id, title: work.title },
      select: { id: true },
    });
    await setMainTaskPhase(adminActor, {
      id: mainTask.id,
      phaseId: phaseIdByName.get(work.phase) as string,
    });
  }

  await seedNorthbayComments(project.id, userIdByEmail, actorFor);
  await seedNorthbayDocument(project.id, userIdByEmail);

  await createPost(adminActor, {
    kind: "ANNOUNCEMENT",
    title: "Site induction refresher — Sunday 07:00",
    body:
      "Everyone working on the Harbor Tower site does the induction refresher this Sunday at 07:00 " +
      "in the site office. Bring your card. Nobody goes past the gate on Monday without it.",
    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  });
}

async function seedNorthbayComments(
  projectId: string,
  userIdByEmail: Map<string, string>,
  actorFor: (email: string) => Promise<ActorContext>,
): Promise<void> {
  const idByTitle = new Map(
    (
      await prisma.disciplineTask.findMany({
        where: { mainTask: { projectId } },
        select: { id: true, title: true },
      })
    ).map((task) => [task.title, task.id]),
  );

  await createComment(await actorFor("hana.suleiman@tielora.example"), {
    body: "Rev 3 issued with the revised opening at grid F. Nothing changed on the perimeter beams.",
    mainTaskId: null,
    disciplineTaskId: idByTitle.get("Slab reinforcement drawings issued") as string,
    mentions: [],
  });

  await createComment(await actorFor("tariq.almamari@tielora.example"), {
    body: "@Peter Novak we cannot pour until the sleeve mark-up is signed. Can you get the marked drawings to me by Thursday?",
    mainTaskId: null,
    disciplineTaskId: idByTitle.get("Pre-pour inspection checklist agreed") as string,
    mentions: [userIdByEmail.get("peter.novak@tielora.example") as string],
  });
}

/** One document at two revisions, so the version history has something real in it here too. */
async function seedNorthbayDocument(
  projectId: string,
  userIdByEmail: Map<string, string>,
): Promise<void> {
  const upload = makeUploader({ projectId, userIdByEmail });
  const checklist = await prisma.disciplineTask.findFirstOrThrow({
    where: { title: "Pre-pour inspection checklist agreed", mainTask: { projectId } },
    select: { id: true },
  });

  const filename = "Level 12 Pre-pour Checklist.pdf";
  const first = await upload(
    "hana.suleiman@tielora.example",
    {
      disciplineTaskId: checklist.id,
      title: "Level 12 Pre-pour Checklist",
      category: "Checklist",
      note: "First issue for comment.",
    },
    filename,
    makePdf("Level 12 pre-pour checklist — Rev 0", [
      "Project: Harbor Tower — Phase 2 (HT-P2)",
      "Pour: Level 12 slab, bays 1 to 4",
      "",
      "1. Reinforcement fixed and tied to drawing S-12-003 Rev 3.",
      "2. Cast-in sleeves and boxes marked up and checked against the MEP drawings.",
      "3. Setting-out survey signed by the surveyor.",
      "4. Edge protection and access in place.",
    ]),
  );

  await upload(
    "tariq.almamari@tielora.example",
    { documentId: first.documentId, note: "Survey sign-off line added after the QA review." },
    filename,
    makePdf("Level 12 pre-pour checklist — Rev 1", [
      "Project: Harbor Tower — Phase 2 (HT-P2)",
      "Pour: Level 12 slab, bays 1 to 4",
      "",
      "1. Reinforcement fixed and tied to drawing S-12-003 Rev 3.",
      "2. Cast-in sleeves and boxes marked up and checked against the MEP drawings.",
      "3. Setting-out survey signed by the surveyor AND the structural lead.",
      "4. Edge protection and access in place.",
      "5. Concrete delivery slots confirmed with the batching plant.",
    ]),
  );
}

/** Clears the Northbay demo project so it can be rebuilt. Development data only. */
async function resetNorthbayProject(orgId: string, projectId: string): Promise<void> {
  const mainTasks = await prisma.mainTask.findMany({ where: { projectId }, select: { id: true } });
  const mainTaskIds = mainTasks.map((task) => task.id);
  const subtasks = await prisma.disciplineTask.findMany({
    where: { mainTaskId: { in: mainTaskIds } },
    select: { id: true },
  });
  const subtaskIds = subtasks.map((task) => task.id);

  await prisma.taskDependency.deleteMany({
    where: { OR: [{ predecessorId: { in: subtaskIds } }, { successorId: { in: subtaskIds } }] },
  });
  await prisma.requiredDocument.deleteMany({ where: { disciplineTaskId: { in: subtaskIds } } });
  await prisma.comment.deleteMany({
    where: { OR: [{ mainTaskId: { in: mainTaskIds } }, { disciplineTaskId: { in: subtaskIds } }] },
  });
  await prisma.documentVersion.deleteMany({ where: { document: { projectId } } });
  await prisma.document.deleteMany({ where: { projectId } });
  await prisma.disciplineTask.deleteMany({ where: { id: { in: subtaskIds } } });
  await prisma.mainTask.deleteMany({ where: { projectId } });
  await prisma.projectPhase.deleteMany({ where: { projectId } });
  await prisma.projectMember.deleteMany({ where: { projectId } });
  await prisma.projectDiscipline.deleteMany({ where: { projectId } });
  // The noticeboard goes too: a company-wide announcement belongs to no project, so deleting the
  // project would leave it behind and the next run would post a second copy of it.
  await prisma.post.deleteMany({ where: { orgId } });
  await prisma.activityLog.deleteMany({ where: { entityType: "Post", actor: { orgId } } });
  await prisma.activityLog.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });

  out(`Cleared the previous ${NORTHBAY_ORG_NAME} demo project ${NORTHBAY_PROJECT_CODE}.`);
}

/** Prints Northbay's small summary and its login, in the same shape the Meridian report uses. */
export async function reportNorthbay(): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { code: NORTHBAY_PROJECT_CODE, organization: { slug: NORTHBAY_ORG_SLUG } },
  });
  if (!project) {
    out("No Northbay demo project found.");
    return;
  }

  const mainTasks = await prisma.mainTask.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { deadline: "asc" },
    include: { _count: { select: { disciplineTasks: true } } },
  });

  const now = new Date();
  out("");
  out(`${NORTHBAY_ORG_NAME} — ${project.name} (${project.code})`);
  for (const task of mainTasks) {
    const shown = effectiveStatus(task.status, task.statusOverride);
    out(
      `  ${task.title.padEnd(34)} ${String(task._count.disciplineTasks).padStart(2)} subtasks  ` +
        `${String(task.progressPct).padStart(3)}%  ${shown}` +
        (isOverdue(task.deadline, shown, now) ? "  overdue" : ""),
    );
  }

  const phases = await prisma.projectPhase.findMany({ where: { projectId: project.id } });
  const phased = await prisma.mainTask.findMany({
    where: { projectId: project.id, phaseId: { not: null }, deletedAt: null },
    select: { phaseId: true, status: true, statusOverride: true },
  });
  const gates = phaseLockedFor(
    phases.map((phase) => {
      const own = phased.filter((task) => task.phaseId === phase.id);
      return {
        id: phase.id,
        name: phase.name,
        sortOrder: phase.sortOrder,
        overridden: phase.overriddenById !== null,
        taskCount: own.length,
        completedCount: own.filter(
          (task) => effectiveStatus(task.status, task.statusOverride) === "COMPLETED",
        ).length,
      };
    }),
  );

  out("");
  out("  Construction phases (from the industry template):");
  for (const gate of sortPhases([...gates.values()])) {
    out(
      `    ${gate.name.padEnd(12)} ${gate.completedCount}/${gate.taskCount} complete` +
        (gate.locked ? `  — locked until ${gate.lockedByPhaseName} is complete` : ""),
    );
  }
}
