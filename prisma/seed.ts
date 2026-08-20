// Seed: the eight disciplines, a demo administrator, a demo team and one fully worked demo project.
//
// Everything after the people is created THROUGH THE SERVICE LAYER, so the demo data has real audit
// rows, real derived progress and real gating — nothing is written straight into the tables.
// Safe to run more than once: it stops if the demo project is already there. Run with SEED_RESET=1
// to rebuild the demo project from scratch (development data only).

import "dotenv/config";
import argon2 from "argon2";
import { prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { RoleName, TaskStatusName } from "@/lib/zod-schemas";
import { actorForUser, type ActorContext } from "@/server/actor";
import { seedComments } from "./seed-comments";
import { seedDocuments } from "./seed-documents";
import { createProject } from "@/server/services/projects";
import {
  addDependency,
  completeDisciplineTask,
  createMainTask,
  overrideMainTaskStatus,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

const DISCIPLINES = [
  { code: "MECH", name: "Mechanical", colorHex: "#00558C", sortOrder: 1 },
  { code: "ELEC", name: "Electrical", colorHex: "#5BC2E7", sortOrder: 2 },
  { code: "INST", name: "Instrumentation", colorHex: "#004F71", sortOrder: 3 },
  { code: "CIVIL", name: "Civil", colorHex: "#8A8D6A", sortOrder: 4 },
  { code: "PROC", name: "Process", colorHex: "#003E51", sortOrder: 5 },
  { code: "HSE", name: "HSE", colorHex: "#3E7A5E", sortOrder: 6 },
  { code: "REL", name: "Reliability", colorHex: "#B08D57", sortOrder: 7 },
  { code: "INSP", name: "Inspection", colorHex: "#7A6A8A", sortOrder: 8 },
];

// Demo credentials for local development only — never use these anywhere real.
const ADMIN_EMAIL = "admin@omanlng.example";
const DEMO_PASSWORD = "Nexus!Demo2026";
const PROJECT_CODE = "SUR-EXP";

type Person = {
  email: string;
  name: string;
  role: RoleName;
  discipline: string | null;
  jobTitle: string;
};

const PEOPLE: Person[] = [
  { email: "layla.alriyami@omanlng.example", name: "Layla al-Riyami", role: "PROJECT_MANAGER", discipline: null, jobTitle: "Project manager" },
  { email: "omar.alhabsi@omanlng.example", name: "Omar al-Habsi", role: "PROJECT_MANAGER", discipline: null, jobTitle: "Deputy project manager" },
  { email: "khalid.alfarsi@omanlng.example", name: "Khalid al-Farsi", role: "DISCIPLINE_LEAD", discipline: "MECH", jobTitle: "Mechanical lead" },
  { email: "fatma.alzadjali@omanlng.example", name: "Fatma al-Zadjali", role: "DISCIPLINE_LEAD", discipline: "ELEC", jobTitle: "Electrical lead" },
  { email: "sarah.whitmore@omanlng.example", name: "Sarah Whitmore", role: "DISCIPLINE_LEAD", discipline: "INST", jobTitle: "Instrumentation lead" },
  { email: "yousuf.alamri@omanlng.example", name: "Yousuf al-Amri", role: "DISCIPLINE_LEAD", discipline: "CIVIL", jobTitle: "Civil lead" },
  { email: "maria.santos@omanlng.example", name: "Maria Santos", role: "DISCIPLINE_LEAD", discipline: "PROC", jobTitle: "Process lead" },
  { email: "salim.alhinai@omanlng.example", name: "Salim al-Hinai", role: "DISCIPLINE_LEAD", discipline: "HSE", jobTitle: "HSE lead" },
  { email: "daniel.okoro@omanlng.example", name: "Daniel Okoro", role: "DISCIPLINE_LEAD", discipline: "REL", jobTitle: "Reliability lead" },
  { email: "aisha.alkindi@omanlng.example", name: "Aisha al-Kindi", role: "DISCIPLINE_LEAD", discipline: "INSP", jobTitle: "Inspection lead" },
  { email: "john.carter@omanlng.example", name: "John Carter", role: "ENGINEER", discipline: "MECH", jobTitle: "Mechanical engineer" },
  { email: "priya.nair@omanlng.example", name: "Priya Nair", role: "ENGINEER", discipline: "INST", jobTitle: "Instrumentation engineer" },
  { email: "ahmed.albalushi@omanlng.example", name: "Ahmed al-Balushi", role: "ENGINEER", discipline: "ELEC", jobTitle: "Electrical engineer" },
];

// Task dates are always stored at UTC midnight — the same invariant the services enforce.
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/* ------------------------------------------------------------------ */
/* The demo project's work                                             */
/* ------------------------------------------------------------------ */

type SeedSubtask = {
  discipline: string;
  title: string;
  assignee: string;
  deadline: string;
  isMandatory?: boolean;
  documents?: { name: string; isMandatory: boolean }[];
  /** Where this task ends up once the seed has driven it there. */
  end?: TaskStatusName;
  note?: string;
};

type SeedMainTask = {
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  startDate: string;
  deadline: string;
  owner: string;
  subtasks: SeedSubtask[];
  /** PROC → MECH → INSP style chains, by subtask title. */
  chain?: string[];
  override?: { status: TaskStatusName; reason: string; by: string };
};

const WORK: SeedMainTask[] = [
  {
    title: "Complete Engineering Design Review",
    description:
      "Close out the multidiscipline design review for the expansion train, including all review comments and the civil load check.",
    priority: "HIGH",
    startDate: "2026-03-15",
    deadline: "2026-09-30",
    owner: "layla.alriyami@omanlng.example",
    subtasks: [
      {
        discipline: "MECH",
        title: "Mechanical design review comments closed",
        assignee: "john.carter@omanlng.example",
        deadline: "2026-08-20",
        documents: [{ name: "Vendor data sheet (nice to have)", isMandatory: false }],
        end: "COMPLETED",
      },
      {
        discipline: "ELEC",
        title: "Electrical single line diagrams reviewed",
        assignee: "ahmed.albalushi@omanlng.example",
        deadline: "2026-08-25",
        end: "COMPLETED",
      },
      {
        discipline: "INST",
        title: "Instrument index and loop drawings reviewed",
        assignee: "priya.nair@omanlng.example",
        deadline: "2026-09-01",
        end: "COMPLETED",
      },
      {
        discipline: "CIVIL",
        title: "Civil foundation load check",
        assignee: "yousuf.alamri@omanlng.example",
        deadline: "2026-09-20",
        documents: [
          { name: "Foundation load calculation report", isMandatory: true },
          { name: "Soil investigation summary", isMandatory: true },
          { name: "Site photographs (nice to have)", isMandatory: false },
        ],
        end: "IN_PROGRESS",
      },
      {
        discipline: "PROC",
        title: "Process safeguarding review sign-off",
        assignee: "maria.santos@omanlng.example",
        deadline: "2026-09-25",
      },
    ],
  },
  {
    title: "Prepare Package A for Final Approval",
    description:
      "Assemble the Package A submission for the client: drawings, calculations, inspection records and the HSE dossier.",
    priority: "MEDIUM",
    startDate: "2026-06-01",
    deadline: "2026-11-15",
    owner: "omar.alhabsi@omanlng.example",
    subtasks: [
      { discipline: "MECH", title: "Mechanical datasheets compiled", assignee: "john.carter@omanlng.example", deadline: "2026-10-20", end: "IN_PROGRESS" },
      { discipline: "ELEC", title: "Electrical load list finalised", assignee: "fatma.alzadjali@omanlng.example", deadline: "2026-10-22", end: "IN_PROGRESS" },
      { discipline: "INST", title: "Control narrative updated", assignee: "sarah.whitmore@omanlng.example", deadline: "2026-10-25" },
      { discipline: "CIVIL", title: "Structural steel drawings issued", assignee: "yousuf.alamri@omanlng.example", deadline: "2026-10-28", end: "IN_PROGRESS" },
      { discipline: "PROC", title: "Heat and material balance rev C", assignee: "maria.santos@omanlng.example", deadline: "2026-10-30" },
      { discipline: "HSE", title: "HSE dossier assembled", assignee: "salim.alhinai@omanlng.example", deadline: "2026-11-01" },
      { discipline: "REL", title: "Criticality assessment attached", assignee: "daniel.okoro@omanlng.example", deadline: "2026-11-03" },
      {
        discipline: "INSP",
        title: "Inspection release certificates collected",
        assignee: "aisha.alkindi@omanlng.example",
        deadline: "2026-11-05",
        end: "BLOCKED",
        note: "The vendor has not released the certificates for the two spare exchangers yet.",
      },
    ],
  },
  {
    title: "Equipment Inspection Close-out",
    description: "Close out the inspection findings raised during the spring shutdown.",
    priority: "MEDIUM",
    startDate: "2026-04-01",
    deadline: "2026-05-25",
    owner: "layla.alriyami@omanlng.example",
    subtasks: [
      { discipline: "INSP", title: "Inspection findings closed", assignee: "aisha.alkindi@omanlng.example", deadline: "2026-05-15", end: "COMPLETED" },
      { discipline: "MECH", title: "Repair work packs signed off", assignee: "khalid.alfarsi@omanlng.example", deadline: "2026-05-18", end: "COMPLETED" },
      { discipline: "REL", title: "Failure history updated", assignee: "daniel.okoro@omanlng.example", deadline: "2026-05-20", end: "COMPLETED" },
    ],
  },
  {
    title: "Vendor Document Review — Compressor Package",
    description:
      "Review and return the compressor package vendor documents within the contractual turnaround.",
    priority: "CRITICAL",
    startDate: "2026-06-15",
    deadline: "2026-08-01",
    owner: "omar.alhabsi@omanlng.example",
    subtasks: [
      { discipline: "MECH", title: "Compressor general arrangement reviewed", assignee: "khalid.alfarsi@omanlng.example", deadline: "2026-07-20", end: "COMPLETED" },
      { discipline: "ELEC", title: "Motor data sheets reviewed", assignee: "ahmed.albalushi@omanlng.example", deadline: "2026-07-22", end: "IN_PROGRESS" },
      { discipline: "INST", title: "Vibration monitoring scope reviewed", assignee: "priya.nair@omanlng.example", deadline: "2026-07-25" },
      { discipline: "REL", title: "Spare parts list reviewed", assignee: "daniel.okoro@omanlng.example", deadline: "2026-07-28" },
    ],
  },
  {
    title: "HAZOP Action Close-out",
    description: "Close the actions raised at the expansion HAZOP workshop.",
    priority: "HIGH",
    startDate: "2026-04-10",
    deadline: "2026-10-15",
    owner: "layla.alriyami@omanlng.example",
    subtasks: [
      { discipline: "HSE", title: "Safety-critical actions closed", assignee: "salim.alhinai@omanlng.example", deadline: "2026-09-10", end: "COMPLETED" },
      { discipline: "PROC", title: "Relief scenario recalculated", assignee: "maria.santos@omanlng.example", deadline: "2026-09-15", end: "COMPLETED" },
      {
        discipline: "REL",
        title: "Reliability improvement action (optional)",
        assignee: "daniel.okoro@omanlng.example",
        deadline: "2026-10-10",
        isMandatory: false,
        end: "IN_PROGRESS",
      },
    ],
    override: {
      status: "COMPLETED",
      reason: "Remaining action transferred to operations MOC-1182",
      by: "layla.alriyami@omanlng.example",
    },
  },
  {
    title: "Commissioning Readiness Walkdown",
    description:
      "Walk down the expansion train ahead of commissioning: process first, then mechanical, then inspection.",
    priority: "MEDIUM",
    startDate: "2026-12-01",
    deadline: "2027-02-15",
    owner: "omar.alhabsi@omanlng.example",
    subtasks: [
      { discipline: "PROC", title: "Process line walkdown", assignee: "maria.santos@omanlng.example", deadline: "2027-01-10" },
      { discipline: "MECH", title: "Mechanical completion walkdown", assignee: "khalid.alfarsi@omanlng.example", deadline: "2027-01-25" },
      { discipline: "INSP", title: "Final inspection walkdown", assignee: "aisha.alkindi@omanlng.example", deadline: "2027-02-10" },
    ],
    chain: ["Process line walkdown", "Mechanical completion walkdown", "Final inspection walkdown"],
  },
];

/* ------------------------------------------------------------------ */
/* The seed itself                                                     */
/* ------------------------------------------------------------------ */

const out = (line: string) => process.stdout.write(`${line}\n`);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

  const disciplineIdByCode = await seedDisciplines();
  const userIdByEmail = await seedPeople(disciplineIdByCode);

  const existing = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (existing && process.env.SEED_RESET !== "1") {
    out(`The demo project ${PROJECT_CODE} is already here, so nothing was rebuilt.`);
    out("Run SEED_RESET=1 npm run seed to rebuild it from scratch (development data only).");
    await report();
    return;
  }
  if (existing) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SEED_RESET deletes audit and document history and is refused in production.",
      );
    }
    await resetDemoProject(existing.id);
  }

  const adminActor = await actorForUser(userIdByEmail.get(ADMIN_EMAIL) as string);
  const actors = new Map<string, ActorContext>();
  const actorFor = async (email: string): Promise<ActorContext> => {
    const cached = actors.get(email);
    if (cached) return cached;
    const actor = await actorForUser(userIdByEmail.get(email) as string);
    actors.set(email, actor);
    return actor;
  };

  const project = await createProject(adminActor, {
    name: "Sur LNG Expansion Project",
    code: PROJECT_CODE,
    description:
      "Expansion of the Sur LNG facility with a fourth train, including the associated utilities, " +
      "electrical upgrades and the jetty modifications. Multidiscipline delivery under one coordination plan.",
    startDate: day("2026-03-01"),
    targetDate: day("2027-12-31"),
    disciplineIds: DISCIPLINES.map((discipline) => disciplineIdByCode.get(discipline.code) as string),
    members: [
      { userId: userIdByEmail.get(ADMIN_EMAIL) as string, projectRole: "ADMIN", disciplineId: null },
      ...PEOPLE.map((person) => ({
        userId: userIdByEmail.get(person.email) as string,
        projectRole: person.role,
        disciplineId: person.discipline ? (disciplineIdByCode.get(person.discipline) as string) : null,
      })),
    ],
  });

  // The discipline leads take their disciplines on this project.
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
        isMandatory: subtask.isMandatory ?? true,
        requiredDocuments: subtask.documents ?? [],
      })),
    });

    const created = await prisma.disciplineTask.findMany({
      where: { mainTaskId: mainTask.id },
      select: { id: true, title: true },
    });
    const idByTitle = new Map(created.map((task) => [task.title, task.id]));

    // The people who own the work move it, so the audit trail reads the way it would in real use.
    for (const subtask of work.subtasks) {
      const taskId = idByTitle.get(subtask.title) as string;
      const actor = await actorFor(subtask.assignee);

      if (subtask.end === "COMPLETED") {
        await completeDisciplineTask(actor, { id: taskId });
      } else if (subtask.end === "IN_PROGRESS") {
        await updateDisciplineTaskStatus(actor, { id: taskId, status: "IN_PROGRESS" });
      } else if (subtask.end === "BLOCKED") {
        await updateDisciplineTaskStatus(actor, { id: taskId, status: "BLOCKED", note: subtask.note });
      }
    }

    for (let index = 0; index + 1 < (work.chain?.length ?? 0); index += 1) {
      const chain = work.chain as string[];
      await addDependency(adminActor, {
        predecessorId: idByTitle.get(chain[index]) as string,
        successorId: idByTitle.get(chain[index + 1]) as string,
      });
    }

    if (work.override) {
      const actor = await actorFor(work.override.by);
      await overrideMainTaskStatus(actor, {
        id: mainTask.id,
        status: work.override.status,
        reason: work.override.reason,
      });
    }
  }

  await seedDocuments({ projectId: project.id, userIdByEmail });
  await seedComments({ projectId: project.id, userIdByEmail, actorFor });

  await report();
}

async function seedDisciplines(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const discipline of DISCIPLINES) {
    const row = await prisma.discipline.upsert({
      where: { code: discipline.code },
      update: { name: discipline.name, colorHex: discipline.colorHex, sortOrder: discipline.sortOrder },
      create: discipline,
    });
    map.set(row.code, row.id);
  }
  return map;
}

async function seedPeople(disciplineIdByCode: Map<string, string>): Promise<Map<string, string>> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const map = new Map<string, string>();

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", isActive: true },
    create: {
      email: ADMIN_EMAIL,
      name: "Nexus Administrator",
      passwordHash,
      role: "ADMIN",
      jobTitle: "System administrator",
    },
  });
  map.set(admin.email, admin.id);

  for (const person of PEOPLE) {
    const disciplineId = person.discipline ? (disciplineIdByCode.get(person.discipline) as string) : null;
    const row = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, role: person.role, disciplineId, jobTitle: person.jobTitle, isActive: true },
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        role: person.role,
        disciplineId,
        jobTitle: person.jobTitle,
      },
    });
    map.set(row.email, row.id);
  }

  return map;
}

/** Clears the demo project so it can be rebuilt. Development data only — never run against real data. */
async function resetDemoProject(projectId: string): Promise<void> {
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
  await prisma.projectMember.deleteMany({ where: { projectId } });
  await prisma.projectDiscipline.deleteMany({ where: { projectId } });
  await prisma.activityLog.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });

  out(`Cleared the previous demo project ${PROJECT_CODE}.`);
}

/** Prints what is now in the database, plus the demo logins. */
async function report(): Promise<void> {
  const project = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (!project) {
    out("No demo project found.");
    return;
  }

  const mainTasks = await prisma.mainTask.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { deadline: "asc" },
    include: { _count: { select: { disciplineTasks: true } } },
  });
  const [users, activity] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.activityLog.count({ where: { projectId: project.id } }),
  ]);

  const now = new Date();
  const rows = mainTasks.map((task) => {
    const shown = effectiveStatus(task.status, task.statusOverride);
    return [
      task.title.length > 42 ? `${task.title.slice(0, 39)}...` : task.title,
      String(task._count.disciplineTasks),
      `${task.progressPct}%`,
      shown + (task.statusOverride ? " (override)" : ""),
      isOverdue(task.deadline, shown, now) ? "overdue" : "",
    ];
  });

  const headers = ["Main task", "Subtasks", "Progress", "Status", "Flag"];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");

  out("");
  out(`${project.name} (${project.code})`);
  out(line(headers));
  out(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) out(line(row));
  out("");
  out(`${users} people, ${mainTasks.length} main tasks, ${activity} audit entries on this project.`);
  out("");
  out("Demo logins (development only — every account uses the same password):");
  out(`  administrator   ${ADMIN_EMAIL}`);
  out(`  project manager ${PEOPLE[0].email}`);
  out(`  discipline lead ${PEOPLE[5].email}`);
  out(`  engineer        ${PEOPLE[10].email}`);
  out(`  password        ${DEMO_PASSWORD}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
