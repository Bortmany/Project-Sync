// Seed: the demo data the app ships with — two companies, so the tenant rule can be seen as well as
// claimed.
//
// Meridian Energy Demo is the main one: eight disciplines, a full team, two contractors from other
// companies, a worked project with stage gates, documents, conversations and a live noticeboard.
// Northbay Construction (prisma/seed-northbay.ts) is a small second company on a different industry
// template, and the second tenant every isolation check is measured against.
//
// Everything after the people is created THROUGH THE SERVICE LAYER, so the demo data has real audit
// rows, real derived progress and real gating — nothing is written straight into the tables.
// Safe to run more than once: it stops if the demo project is already there. Run with SEED_RESET=1
// to rebuild the demo project from scratch (development data only).

import "dotenv/config";
import argon2 from "argon2";
import { prisma } from "@/lib/db";
import { phaseLockedFor, sortPhases } from "@/lib/phase-lock";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { RoleName, TaskStatusName } from "@/lib/zod-schemas";
import { actorForUser, type ActorContext } from "@/server/actor";
import { seedComments } from "./seed-comments";
import { seedDocuments } from "./seed-documents";
import {
  NORTHBAY_ADMIN_EMAIL,
  NORTHBAY_ORG_NAME,
  reportNorthbay,
  seedNorthbay,
} from "./seed-northbay";
import { seedPosts } from "./seed-posts";
import { createProject, upsertMember } from "@/server/services/projects";
import {
  addDependency,
  completeDisciplineTask,
  createMainTask,
  overrideMainTaskStatus,
  setMainTaskPhase,
  updateDisciplineTask,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

const DISCIPLINES = [
  { code: "MECH", name: "Mechanical", colorHex: "#2E5AAC", sortOrder: 1 },
  { code: "ELEC", name: "Electrical", colorHex: "#46C4B0", sortOrder: 2 },
  { code: "INST", name: "Instrumentation", colorHex: "#1F3D77", sortOrder: 3 },
  { code: "CIVIL", name: "Civil", colorHex: "#7A8450", sortOrder: 4 },
  { code: "PROC", name: "Process", colorHex: "#152647", sortOrder: 5 },
  { code: "HSE", name: "HSE", colorHex: "#2F7D63", sortOrder: 6 },
  { code: "REL", name: "Reliability", colorHex: "#A8763C", sortOrder: 7 },
  { code: "INSP", name: "Inspection", colorHex: "#6B5B95", sortOrder: 8 },
];

// The demo company every seeded person and project belongs to. Real companies arrive through
// /api/auth/signup; this one exists so a fresh checkout has something to look at.
const ORG_NAME = "Meridian Energy Demo";
const ORG_SLUG = "meridian-energy-demo";
const ORG_TEMPLATE = "OIL_AND_GAS";

// Demo credentials for local development only — never use these anywhere real.
const ADMIN_EMAIL = "admin@tielora.example";
const DEMO_PASSWORD = "Meridian!Demo2026";
const PROJECT_CODE = "SUR-EXP";

type Person = {
  email: string;
  name: string;
  role: RoleName;
  discipline: string | null;
  jobTitle: string;
};

const PEOPLE: Person[] = [
  { email: "layla.alriyami@tielora.example", name: "Layla al-Riyami", role: "PROJECT_MANAGER", discipline: null, jobTitle: "Project manager" },
  { email: "omar.alhabsi@tielora.example", name: "Omar al-Habsi", role: "PROJECT_MANAGER", discipline: null, jobTitle: "Deputy project manager" },
  { email: "khalid.alfarsi@tielora.example", name: "Khalid al-Farsi", role: "DISCIPLINE_LEAD", discipline: "MECH", jobTitle: "Mechanical lead" },
  { email: "fatma.alzadjali@tielora.example", name: "Fatma al-Zadjali", role: "DISCIPLINE_LEAD", discipline: "ELEC", jobTitle: "Electrical lead" },
  { email: "sarah.whitmore@tielora.example", name: "Sarah Whitmore", role: "DISCIPLINE_LEAD", discipline: "INST", jobTitle: "Instrumentation lead" },
  { email: "yousuf.alamri@tielora.example", name: "Yousuf al-Amri", role: "DISCIPLINE_LEAD", discipline: "CIVIL", jobTitle: "Civil lead" },
  { email: "maria.santos@tielora.example", name: "Maria Santos", role: "DISCIPLINE_LEAD", discipline: "PROC", jobTitle: "Process lead" },
  { email: "salim.alhinai@tielora.example", name: "Salim al-Hinai", role: "DISCIPLINE_LEAD", discipline: "HSE", jobTitle: "HSE lead" },
  { email: "daniel.okoro@tielora.example", name: "Daniel Okoro", role: "DISCIPLINE_LEAD", discipline: "REL", jobTitle: "Reliability lead" },
  { email: "aisha.alkindi@tielora.example", name: "Aisha al-Kindi", role: "DISCIPLINE_LEAD", discipline: "INSP", jobTitle: "Inspection lead" },
  { email: "john.carter@tielora.example", name: "John Carter", role: "ENGINEER", discipline: "MECH", jobTitle: "Mechanical engineer" },
  { email: "priya.nair@tielora.example", name: "Priya Nair", role: "ENGINEER", discipline: "INST", jobTitle: "Instrumentation engineer" },
  { email: "ahmed.albalushi@tielora.example", name: "Ahmed al-Balushi", role: "ENGINEER", discipline: "ELEC", jobTitle: "Electrical engineer" },
];

/**
 * The two contractors from other companies. They are ordinary accounts with `EXTERNAL` and a
 * company name; everything that makes them contractors — the project seat, the work handed to them
 * and the sign-off their finished work waits for — is done through the services below.
 */
type Contractor = Person & { companyName: string };

const CONTRACTORS: Contractor[] = [
  {
    email: "rashid.albalushi@tielora.example",
    name: "Rashid al-Balushi",
    role: "EXTERNAL",
    discipline: "MECH",
    jobTitle: "Mechanical package engineer",
    companyName: "Gulf Fabrication LLC",
  },
  {
    email: "elena.petrova@tielora.example",
    name: "Elena Petrova",
    role: "EXTERNAL",
    discipline: "INSP",
    jobTitle: "NDT inspection engineer",
    companyName: "Coastal NDT Services",
  },
];

/** Work handed over to a contractor, and who hands it over — always that discipline's own lead. */
const CONTRACTOR_HANDOVERS: { task: string; to: string; by: string }[] = [
  {
    task: "Mechanical datasheets compiled",
    to: "rashid.albalushi@tielora.example",
    by: "khalid.alfarsi@tielora.example",
  },
  {
    task: "Mechanical completion walkdown",
    to: "rashid.albalushi@tielora.example",
    by: "khalid.alfarsi@tielora.example",
  },
  {
    task: "Inspection release certificates collected",
    to: "elena.petrova@tielora.example",
    by: "aisha.alkindi@tielora.example",
  },
];

/**
 * The one piece of contractor work that is handed in and waiting for a colleague to accept it, so
 * the dashboard really does say "Needs your sign-off (1)". It goes through the ordinary completion
 * path as the contractor: the service itself turns that into AWAITING_REVIEW.
 */
const CONTRACTOR_SUBMISSION = {
  task: "Mechanical datasheets compiled",
  by: "rashid.albalushi@tielora.example",
};

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
  /**
   * Which stage gate this work sits behind, by phase name. Left out, the task is unphased and is
   * never gated — the demo shows both. Phases are assigned AFTER the work has been driven to its
   * end state, because a locked phase would (rightly) refuse those very completions.
   */
  phase?: string;
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
    owner: "layla.alriyami@tielora.example",
    phase: "FEED",
    subtasks: [
      {
        discipline: "MECH",
        title: "Mechanical design review comments closed",
        assignee: "john.carter@tielora.example",
        deadline: "2026-08-20",
        documents: [{ name: "Vendor data sheet (nice to have)", isMandatory: false }],
        end: "COMPLETED",
      },
      {
        discipline: "ELEC",
        title: "Electrical single line diagrams reviewed",
        assignee: "ahmed.albalushi@tielora.example",
        deadline: "2026-08-25",
        end: "COMPLETED",
      },
      {
        discipline: "INST",
        title: "Instrument index and loop drawings reviewed",
        assignee: "priya.nair@tielora.example",
        deadline: "2026-09-01",
        end: "COMPLETED",
      },
      {
        discipline: "CIVIL",
        title: "Civil foundation load check",
        assignee: "yousuf.alamri@tielora.example",
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
        assignee: "maria.santos@tielora.example",
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
    owner: "omar.alhabsi@tielora.example",
    phase: "Detail design",
    subtasks: [
      { discipline: "MECH", title: "Mechanical datasheets compiled", assignee: "john.carter@tielora.example", deadline: "2026-10-20", end: "IN_PROGRESS" },
      { discipline: "ELEC", title: "Electrical load list finalised", assignee: "fatma.alzadjali@tielora.example", deadline: "2026-10-22", end: "IN_PROGRESS" },
      { discipline: "INST", title: "Control narrative updated", assignee: "sarah.whitmore@tielora.example", deadline: "2026-10-25" },
      { discipline: "CIVIL", title: "Structural steel drawings issued", assignee: "yousuf.alamri@tielora.example", deadline: "2026-10-28", end: "IN_PROGRESS" },
      { discipline: "PROC", title: "Heat and material balance rev C", assignee: "maria.santos@tielora.example", deadline: "2026-10-30" },
      { discipline: "HSE", title: "HSE dossier assembled", assignee: "salim.alhinai@tielora.example", deadline: "2026-11-01" },
      { discipline: "REL", title: "Criticality assessment attached", assignee: "daniel.okoro@tielora.example", deadline: "2026-11-03" },
      {
        discipline: "INSP",
        title: "Inspection release certificates collected",
        assignee: "aisha.alkindi@tielora.example",
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
    owner: "layla.alriyami@tielora.example",
    subtasks: [
      { discipline: "INSP", title: "Inspection findings closed", assignee: "aisha.alkindi@tielora.example", deadline: "2026-05-15", end: "COMPLETED" },
      { discipline: "MECH", title: "Repair work packs signed off", assignee: "khalid.alfarsi@tielora.example", deadline: "2026-05-18", end: "COMPLETED" },
      { discipline: "REL", title: "Failure history updated", assignee: "daniel.okoro@tielora.example", deadline: "2026-05-20", end: "COMPLETED" },
    ],
  },
  {
    title: "Vendor Document Review — Compressor Package",
    description:
      "Review and return the compressor package vendor documents within the contractual turnaround.",
    priority: "CRITICAL",
    startDate: "2026-06-15",
    deadline: "2026-08-01",
    owner: "omar.alhabsi@tielora.example",
    phase: "Procurement",
    subtasks: [
      { discipline: "MECH", title: "Compressor general arrangement reviewed", assignee: "khalid.alfarsi@tielora.example", deadline: "2026-07-20", end: "COMPLETED" },
      { discipline: "ELEC", title: "Motor data sheets reviewed", assignee: "ahmed.albalushi@tielora.example", deadline: "2026-07-22", end: "IN_PROGRESS" },
      { discipline: "INST", title: "Vibration monitoring scope reviewed", assignee: "priya.nair@tielora.example", deadline: "2026-07-25" },
      { discipline: "REL", title: "Spare parts list reviewed", assignee: "daniel.okoro@tielora.example", deadline: "2026-07-28" },
    ],
  },
  {
    title: "HAZOP Action Close-out",
    description: "Close the actions raised at the expansion HAZOP workshop.",
    priority: "HIGH",
    startDate: "2026-04-10",
    deadline: "2026-10-15",
    owner: "layla.alriyami@tielora.example",
    phase: "FEED",
    subtasks: [
      { discipline: "HSE", title: "Safety-critical actions closed", assignee: "salim.alhinai@tielora.example", deadline: "2026-09-10", end: "COMPLETED" },
      { discipline: "PROC", title: "Relief scenario recalculated", assignee: "maria.santos@tielora.example", deadline: "2026-09-15", end: "COMPLETED" },
      {
        discipline: "REL",
        title: "Reliability improvement action (optional)",
        assignee: "daniel.okoro@tielora.example",
        deadline: "2026-10-10",
        isMandatory: false,
        end: "IN_PROGRESS",
      },
    ],
    override: {
      status: "COMPLETED",
      reason: "Remaining action transferred to operations MOC-1182",
      by: "layla.alriyami@tielora.example",
    },
  },
  {
    title: "Commissioning Readiness Walkdown",
    description:
      "Walk down the expansion train ahead of commissioning: process first, then mechanical, then inspection.",
    priority: "MEDIUM",
    startDate: "2026-12-01",
    deadline: "2027-02-15",
    owner: "omar.alhabsi@tielora.example",
    phase: "Commissioning",
    subtasks: [
      { discipline: "PROC", title: "Process line walkdown", assignee: "maria.santos@tielora.example", deadline: "2027-01-10" },
      { discipline: "MECH", title: "Mechanical completion walkdown", assignee: "khalid.alfarsi@tielora.example", deadline: "2027-01-25" },
      { discipline: "INSP", title: "Final inspection walkdown", assignee: "aisha.alkindi@tielora.example", deadline: "2027-02-10" },
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

  // One hash for every demo account, in both companies — argon2 is deliberately slow, so it is
  // computed once and reused rather than per person.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  await seedMeridian(passwordHash);
  await seedNorthbay({ passwordHash });

  await report();
  await reportNorthbay();
  await reportLogins();
}

/** The main demo company: eight disciplines, a full team, two contractors and one worked project. */
async function seedMeridian(passwordHash: string): Promise<void> {
  const org = await seedOrganization();
  const disciplineIdByCode = await seedDisciplines(org.id);
  const userIdByEmail = await seedPeople(org.id, disciplineIdByCode, passwordHash);

  const existing = await prisma.project.findUnique({
    where: { orgId_code: { orgId: org.id, code: PROJECT_CODE } },
  });
  if (existing && process.env.SEED_RESET !== "1") {
    out(`The demo project ${PROJECT_CODE} is already here, so nothing was rebuilt.`);
    out("Run SEED_RESET=1 npm run seed to rebuild it from scratch (development data only).");
    return;
  }
  if (existing) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SEED_RESET deletes audit and document history and is refused in production.",
      );
    }
    await resetDemoProject(org.id, existing.id);
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

  // The contractors join and take their work over. This happens BEFORE the gates go on, for the
  // same reason every other status change above does: a locked phase would (rightly) refuse the
  // hand-in that has to be waiting for a sign-off when the demo opens.
  await seedContractors({
    projectId: project.id,
    disciplineIdByCode,
    userIdByEmail,
    adminActor,
    actorFor,
  });

  // The stage gates. createProject already made the five OIL_AND_GAS phases; the work is put behind
  // them LAST, once every completion above has happened, because a locked phase refuses exactly
  // those transitions. The result is a realistic mid-project picture: FEED is still open (the civil
  // load check is unfinished), so Detail design, Procurement, Construction and Commissioning are all
  // locked, and the inspection close-out sits outside the gates entirely.
  const phaseIdByName = new Map(
    (await prisma.projectPhase.findMany({ where: { projectId: project.id } })).map((phase) => [
      phase.name,
      phase.id,
    ]),
  );
  for (const work of WORK) {
    if (!work.phase) continue;
    const mainTask = await prisma.mainTask.findFirstOrThrow({
      where: { projectId: project.id, title: work.title },
      select: { id: true },
    });
    await setMainTaskPhase(adminActor, {
      id: mainTask.id,
      phaseId: phaseIdByName.get(work.phase) as string,
    });
  }

  await seedDocuments({ projectId: project.id, userIdByEmail });
  await seedComments({ projectId: project.id, userIdByEmail, actorFor });
  await seedPosts({ projectId: project.id, disciplineIdByCode, actorFor });
}

/**
 * The contractors' part of the demo, all of it through the real doors:
 * `upsertMember` for the project seat, `updateDisciplineTask` for the hand-over, and the ordinary
 * completion path for the hand-in — which the service turns into AWAITING_REVIEW by itself, because
 * the project asks for an internal sign-off on a contractor's finished work.
 */
async function seedContractors(ctx: {
  projectId: string;
  disciplineIdByCode: Map<string, string>;
  userIdByEmail: Map<string, string>;
  adminActor: ActorContext;
  actorFor: (email: string) => Promise<ActorContext>;
}): Promise<void> {
  for (const contractor of CONTRACTORS) {
    await upsertMember(ctx.adminActor, {
      projectId: ctx.projectId,
      userId: ctx.userIdByEmail.get(contractor.email) as string,
      projectRole: "EXTERNAL",
      disciplineId: ctx.disciplineIdByCode.get(contractor.discipline as string) as string,
    });
  }

  const taskIdByTitle = new Map(
    (
      await prisma.disciplineTask.findMany({
        where: { mainTask: { projectId: ctx.projectId } },
        select: { id: true, title: true },
      })
    ).map((task) => [task.title, task.id]),
  );
  const taskId = (title: string): string => {
    const id = taskIdByTitle.get(title);
    if (!id) throw new Error(`The seed has no discipline task called "${title}".`);
    return id;
  };

  for (const handover of CONTRACTOR_HANDOVERS) {
    await updateDisciplineTask(await ctx.actorFor(handover.by), {
      id: taskId(handover.task),
      assigneeId: ctx.userIdByEmail.get(handover.to) as string,
    });
  }

  await completeDisciplineTask(await ctx.actorFor(CONTRACTOR_SUBMISSION.by), {
    id: taskId(CONTRACTOR_SUBMISSION.task),
  });
}

/** The demo company itself. Everything else the seed writes belongs to it. */
async function seedOrganization(): Promise<{ id: string }> {
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME },
    create: { name: ORG_NAME, slug: ORG_SLUG, industryTemplate: ORG_TEMPLATE },
    select: { id: true },
  });
  return org;
}

async function seedDisciplines(orgId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const discipline of DISCIPLINES) {
    const row = await prisma.discipline.upsert({
      where: { orgId_code: { orgId, code: discipline.code } },
      update: { name: discipline.name, colorHex: discipline.colorHex, sortOrder: discipline.sortOrder },
      create: { ...discipline, orgId },
    });
    map.set(row.code, row.id);
  }
  return map;
}

async function seedPeople(
  orgId: string,
  disciplineIdByCode: Map<string, string>,
  passwordHash: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", isActive: true },
    create: {
      orgId,
      email: ADMIN_EMAIL,
      name: "Meridian Administrator",
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
        orgId,
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

  // The contractors. The company name is what shows as the badge beside their name on every task,
  // comment and document, and an EXTERNAL account is never allowed to be without one.
  for (const contractor of CONTRACTORS) {
    const row = await prisma.user.upsert({
      where: { email: contractor.email },
      update: {
        name: contractor.name,
        role: "EXTERNAL",
        disciplineId: disciplineIdByCode.get(contractor.discipline as string) as string,
        jobTitle: contractor.jobTitle,
        companyName: contractor.companyName,
        isActive: true,
      },
      create: {
        orgId,
        email: contractor.email,
        name: contractor.name,
        passwordHash,
        role: "EXTERNAL",
        disciplineId: disciplineIdByCode.get(contractor.discipline as string) as string,
        jobTitle: contractor.jobTitle,
        companyName: contractor.companyName,
      },
    });
    map.set(row.email, row.id);
  }

  return map;
}

/** Clears the demo project so it can be rebuilt. Development data only — never run against real data. */
async function resetDemoProject(orgId: string, projectId: string): Promise<void> {
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
  // Phases go after the main tasks that point at them — the same order the Restrict rule requires.
  await prisma.projectPhase.deleteMany({ where: { projectId } });
  await prisma.projectMember.deleteMany({ where: { projectId } });
  await prisma.projectDiscipline.deleteMany({ where: { projectId } });
  // The noticeboard goes with it. A company-wide or department announcement belongs to no project,
  // so deleting the project alone would leave it behind and the next run would post a second copy.
  await prisma.post.deleteMany({ where: { orgId } });
  await prisma.activityLog.deleteMany({ where: { entityType: "Post", actor: { orgId } } });
  await prisma.activityLog.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });

  out(`Cleared the previous demo project ${PROJECT_CODE}.`);
}

/** Prints what is now in the database, plus the demo logins. */
async function report(): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { code: PROJECT_CODE, organization: { slug: ORG_SLUG } },
  });
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
    prisma.user.count({ where: { orgId: project.orgId, isActive: true } }),
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
  // The stage gates, with the lock state derived exactly the way the app derives it.
  const phases = await prisma.projectPhase.findMany({ where: { projectId: project.id } });
  const phaseTasks = await prisma.mainTask.findMany({
    where: { projectId: project.id, phaseId: { not: null }, deletedAt: null },
    select: { phaseId: true, status: true, statusOverride: true },
  });
  const gates = phaseLockedFor(
    phases.map((phase) => {
      const own = phaseTasks.filter((task) => task.phaseId === phase.id);
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
  out("Phases (locked is derived, never stored):");
  for (const gate of sortPhases([...gates.values()])) {
    out(
      `  ${gate.name.padEnd(16)} ${gate.completedCount}/${gate.taskCount} complete` +
        (gate.locked ? `  — locked until ${gate.lockedByPhaseName} is complete` : ""),
    );
  }

  const [awaitingSignoff, announcements] = await Promise.all([
    prisma.disciplineTask.count({
      where: { status: "AWAITING_REVIEW", deletedAt: null, mainTask: { projectId: project.id } },
    }),
    prisma.post.count({
      where: { orgId: project.orgId, kind: "ANNOUNCEMENT", parentId: null, deletedAt: null },
    }),
  ]);

  out("");
  out(`${users} people, ${mainTasks.length} main tasks, ${activity} audit entries on this project.`);
  out(
    `${awaitingSignoff} piece${awaitingSignoff === 1 ? "" : "s"} of contractor work waiting for a sign-off, ` +
      `${announcements} announcement${announcements === 1 ? "" : "s"} running.`,
  );
}

/** Every demo login, in one place at the end of the run. Development only. */
async function reportLogins(): Promise<void> {
  out("");
  out(`Demo logins for ${ORG_NAME} (development only — every account uses the same password):`);
  out(`  administrator   ${ADMIN_EMAIL}`);
  out(`  project manager ${PEOPLE[0].email}`);
  out(`  discipline lead ${PEOPLE[5].email}`);
  out(`  engineer        ${PEOPLE[10].email}`);
  for (const contractor of CONTRACTORS) {
    out(`  contractor      ${contractor.email.padEnd(34)} ${contractor.companyName}`);
  }
  out("");
  out(`Demo login for ${NORTHBAY_ORG_NAME} (the second company — same password):`);
  out(`  administrator   ${NORTHBAY_ADMIN_EMAIL}`);
  out("");
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
