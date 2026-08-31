// The Admin section: the people directory and the discipline catalogue. Administrators only —
// and an administrator administers THEIR OWN COMPANY. Every read and every write below is filtered
// by the actor's orgId, and a new account is created inside the actor's organisation; there is no
// way through this file to see, change or create a person or a discipline anywhere else.
// Every mutation: assertCan → transaction → audit row in the same transaction → typed DTO.
// Passwords are hashed before they reach the database and never appear in an audit row or a log.

import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DISCIPLINE_PALETTE, isPaletteColor } from "@/lib/discipline-colors";
import { assertCan } from "@/lib/permissions";
import type {
  CreateDisciplineInput,
  CreateUserInput,
  DisciplineDTO,
  RoleName,
  UpdateDisciplineInput,
  UpdateUserInput,
  UserDTO,
} from "@/lib/zod-schemas";
import { DisciplineDTO as DisciplineSchema, UserDTO as UserSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";

/** The roles whose work always belongs to one discipline. */
const DISCIPLINE_ROLES: RoleName[] = ["DISCIPLINE_LEAD", "ENGINEER"];

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  disciplineId: true,
  jobTitle: true,
  companyName: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  discipline: { select: { code: true } },
} as const;

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  disciplineId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  discipline: { code: string } | null;
};

function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disciplineId: row.disciplineId,
    disciplineCode: row.discipline?.code ?? null,
    jobTitle: row.jobTitle,
    companyName: row.companyName,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Everyone, deactivated people included — the admin screen is the one place that shows them. */
export async function listAllUsers(actor: ActorContext): Promise<UserDTO[]> {
  assertCan(actor, "MANAGE_USERS");

  const rows = await prisma.user.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: USER_SELECT,
  });

  return checkDtoList(UserSchema, rows.map(toUserDTO), "UserDTO");
}

/** The discipline catalogue as the admin screen shows it, in the order the business lists them. */
export async function listDisciplinesForAdmin(actor: ActorContext): Promise<DisciplineDTO[]> {
  assertCan(actor, "MANAGE_DISCIPLINES");

  const rows = await prisma.discipline.findMany({
    where: { orgId: actor.orgId },
    orderBy: { sortOrder: "asc" },
  });
  const items = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    colorHex: row.colorHex,
    sortOrder: row.sortOrder,
  }));

  return checkDtoList(DisciplineSchema, items, "DisciplineDTO");
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

async function assertDisciplineChoice(
  actor: ActorContext,
  role: RoleName,
  disciplineId: string | null | undefined,
): Promise<void> {
  if (DISCIPLINE_ROLES.includes(role) && !disciplineId) {
    throw new ServiceError("Choose a discipline for a discipline lead or an engineer.", {
      disciplineId: ["Choose a discipline for a discipline lead or an engineer."],
    });
  }
  if (!disciplineId) return;

  const discipline = await prisma.discipline.findFirst({
    where: { id: disciplineId, orgId: actor.orgId },
    select: { id: true },
  });
  if (!discipline) throw new NotFoundError("We could not find that discipline.");
}

/**
 * A contractor must say whose contractor they are: the company badge beside their name on every
 * task, comment and document is the whole point of the role, and it cannot be blank.
 * Nobody else carries one, so it is cleared when somebody stops being external.
 */
function companyNameFor(role: RoleName, companyName: string | null | undefined): string | null {
  if (role !== "EXTERNAL") return null;
  const trimmed = companyName?.trim();
  if (!trimmed) {
    throw new ServiceError("Give the contractor's company name.", {
      companyName: ["Give the contractor's company name."],
    });
  }
  return trimmed;
}

/**
 * Creates an account inside the administrator's own company. Signup creates the FIRST person in a
 * company; this is how every colleague after them gets in. The new account's orgId is taken from
 * the actor, never from the form — there is no way to add someone to another organisation.
 */
export async function createUser(actor: ActorContext, input: CreateUserInput): Promise<UserDTO> {
  assertCan(actor, "MANAGE_USERS");

  // Email addresses are unique across the whole product — one address signs in to one company —
  // so the answer to "is this taken?" cannot be narrowed to this organisation.
  const clash = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (clash) {
    throw new ServiceError("A user with this email already exists.", {
      email: ["A user with this email already exists."],
    });
  }

  await assertDisciplineChoice(actor, input.role, input.disciplineId);
  const companyName = companyNameFor(input.role, input.companyName);
  const passwordHash = await hashPassword(input.password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        orgId: actor.orgId,
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role,
        disciplineId: input.disciplineId ?? null,
        jobTitle: input.jobTitle ?? null,
        companyName,
      },
      select: USER_SELECT,
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.USER_CREATED,
      summary:
        `${actor.name} created an account for ${user.name}` +
        (user.companyName ? ` of ${user.companyName}` : ""),
      metadata: { role: user.role, disciplineId: user.disciplineId, companyName: user.companyName },
    });

    return user;
  });

  return checkDto(UserSchema, toUserDTO(created), "UserDTO");
}

/** Changes someone's details. A new password may be set here; it is only ever stored hashed. */
export async function updateUser(actor: ActorContext, input: UpdateUserInput): Promise<UserDTO> {
  assertCan(actor, "MANAGE_USERS");

  const existing = await prisma.user.findFirst({
    where: { id: input.id, orgId: actor.orgId },
    select: USER_SELECT,
  });
  if (!existing) throw new NotFoundError("We could not find that person.");

  const nextRole = input.role ?? existing.role;
  const nextDisciplineId =
    input.disciplineId === undefined ? existing.disciplineId : input.disciplineId;
  await assertDisciplineChoice(actor, nextRole, nextDisciplineId);
  const nextCompanyName = companyNameFor(
    nextRole,
    input.companyName === undefined ? existing.companyName : input.companyName,
  );

  // Nobody locks themselves out: neither by dropping their own administrator role...
  if (existing.id === actor.userId && nextRole !== "ADMIN") {
    throw new ServiceError("You cannot remove your own administrator access.");
  }
  if (input.isActive === false && existing.id === actor.userId) {
    throw new ServiceError("You cannot deactivate your own account.");
  }

  // ...nor by leaving the app with no administrator who can still sign in.
  const nextIsActive = input.isActive ?? existing.isActive;
  const wasActiveAdmin = existing.role === "ADMIN" && existing.isActive;
  if (wasActiveAdmin && (nextRole !== "ADMIN" || !nextIsActive)) {
    // "The last administrator" is counted inside this company only.
    const activeAdmins = await prisma.user.count({
      where: { orgId: actor.orgId, role: "ADMIN", isActive: true },
    });
    if (activeAdmins <= 1) {
      throw new ServiceError(
        "This is the only administrator who can sign in. Give someone else administrator access first.",
      );
    }
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        role: input.role ?? undefined,
        disciplineId: input.disciplineId === undefined ? undefined : input.disciplineId,
        jobTitle: input.jobTitle === undefined ? undefined : input.jobTitle,
        companyName: nextCompanyName,
        isActive: input.isActive ?? undefined,
        passwordHash,
      },
      select: USER_SELECT,
    });

    // The audit row records which fields actually moved, never a password value. The edit form
    // sends every field every time, so "was it sent?" would list fields nobody touched.
    const changed = [
      input.name !== undefined && input.name !== existing.name ? "name" : null,
      input.role !== undefined && input.role !== existing.role ? "role" : null,
      input.disciplineId !== undefined && input.disciplineId !== existing.disciplineId
        ? "discipline"
        : null,
      input.jobTitle !== undefined && input.jobTitle !== existing.jobTitle ? "job title" : null,
      nextCompanyName !== existing.companyName ? "company" : null,
      input.isActive !== undefined && input.isActive !== existing.isActive ? "sign-in access" : null,
      passwordHash ? "password" : null,
    ].filter((field): field is string => field !== null);

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action:
        input.isActive === true && !existing.isActive ? ACTIVITY.USER_REACTIVATED : ACTIVITY.USER_UPDATED,
      summary: `${actor.name} updated ${user.name}'s account${
        changed.length > 0 ? ` (${changed.join(", ")})` : ""
      }`,
      metadata: { changed, role: user.role, isActive: user.isActive },
    });

    return user;
  });

  return checkDto(UserSchema, toUserDTO(updated), "UserDTO");
}

/**
 * Switches sign-in off. The account and everything it did stay on record — nothing is deleted —
 * and any session it still holds is dropped so the change takes effect at once.
 */
export async function deactivateUser(actor: ActorContext, input: { id: string }): Promise<UserDTO> {
  assertCan(actor, "MANAGE_USERS");

  const existing = await prisma.user.findFirst({
    where: { id: input.id, orgId: actor.orgId },
    select: USER_SELECT,
  });
  if (!existing) throw new NotFoundError("We could not find that person.");
  if (existing.id === actor.userId) {
    throw new ServiceError("You cannot deactivate your own account.");
  }
  if (!existing.isActive) return checkDto(UserSchema, toUserDTO(existing), "UserDTO");

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: existing.id },
      data: { isActive: false },
      select: USER_SELECT,
    });
    await tx.session.deleteMany({ where: { userId: existing.id } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.USER_DEACTIVATED,
      summary: `${actor.name} deactivated ${user.name}'s account`,
    });

    return user;
  });

  return checkDto(UserSchema, toUserDTO(updated), "UserDTO");
}

/* ------------------------------------------------------------------ */
/* Disciplines                                                         */
/* ------------------------------------------------------------------ */

/** One refusal, worded once, with the field the form should highlight. */
function fail(message: string, field: "code" | "name"): never {
  throw new ServiceError(message, { [field]: [message] });
}

function assertPaletteColor(colorHex: string): void {
  if (isPaletteColor(colorHex)) return;
  throw new ServiceError(
    `Pick a colour from the list — ${DISCIPLINE_PALETTE.map((color) => color.label).join(", ")}.`,
    { colorHex: ["Pick one of the listed colours."] },
  );
}

/** Adds a discipline to the catalogue every project picks from. */
export async function createDiscipline(
  actor: ActorContext,
  input: CreateDisciplineInput,
): Promise<DisciplineDTO> {
  assertCan(actor, "MANAGE_DISCIPLINES");
  assertPaletteColor(input.colorHex);

  // Codes and names are unique inside a company, not across the product: another customer running
  // a "CIVIL" discipline is none of this company's business.
  const clash = await prisma.discipline.findFirst({
    where: { orgId: actor.orgId, OR: [{ code: input.code }, { name: input.name }] },
    select: { code: true },
  });
  if (clash) {
    return clash.code === input.code
      ? fail("A discipline with this code already exists.", "code")
      : fail("A discipline with this name already exists.", "name");
  }

  const created = await prisma.$transaction(async (tx) => {
    const discipline = await tx.discipline.create({
      data: {
        orgId: actor.orgId,
        code: input.code,
        name: input.name,
        colorHex: input.colorHex,
        sortOrder: input.sortOrder,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Discipline",
      entityId: discipline.id,
      action: ACTIVITY.DISCIPLINE_CREATED,
      summary: `${actor.name} added the ${discipline.name} discipline`,
      metadata: { code: discipline.code },
    });

    return discipline;
  });

  return checkDto(
    DisciplineSchema,
    {
      id: created.id,
      code: created.code,
      name: created.name,
      colorHex: created.colorHex,
      sortOrder: created.sortOrder,
    },
    "DisciplineDTO",
  );
}

/** Renames a discipline or restyles it. The code never changes — projects and tasks point at it. */
export async function updateDiscipline(
  actor: ActorContext,
  input: UpdateDisciplineInput,
): Promise<DisciplineDTO> {
  assertCan(actor, "MANAGE_DISCIPLINES");
  if (input.colorHex) assertPaletteColor(input.colorHex);

  const existing = await prisma.discipline.findFirst({
    where: { id: input.id, orgId: actor.orgId },
  });
  if (!existing) throw new NotFoundError("We could not find that discipline.");

  if (input.name && input.name !== existing.name) {
    const nameClash = await prisma.discipline.findFirst({
      where: { orgId: actor.orgId, name: input.name, id: { not: existing.id } },
      select: { id: true },
    });
    if (nameClash) fail("A discipline with this name already exists.", "name");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const discipline = await tx.discipline.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        colorHex: input.colorHex ?? undefined,
        sortOrder: input.sortOrder ?? undefined,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Discipline",
      entityId: discipline.id,
      action: ACTIVITY.DISCIPLINE_UPDATED,
      summary: `${actor.name} updated the ${discipline.name} discipline`,
      metadata: {
        before: { name: existing.name, colorHex: existing.colorHex, sortOrder: existing.sortOrder },
        after: {
          name: discipline.name,
          colorHex: discipline.colorHex,
          sortOrder: discipline.sortOrder,
        },
      },
    });

    return discipline;
  });

  return checkDto(
    DisciplineSchema,
    {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      colorHex: updated.colorHex,
      sortOrder: updated.sortOrder,
    },
    "DisciplineDTO",
  );
}
