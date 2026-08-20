// The Admin section: the people directory and the discipline catalogue. Administrators only.
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
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: USER_SELECT,
  });

  return checkDtoList(UserSchema, rows.map(toUserDTO), "UserDTO");
}

/** The discipline catalogue as the admin screen shows it, in the order the business lists them. */
export async function listDisciplinesForAdmin(actor: ActorContext): Promise<DisciplineDTO[]> {
  assertCan(actor, "MANAGE_DISCIPLINES");

  const rows = await prisma.discipline.findMany({ orderBy: { sortOrder: "asc" } });
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
  role: RoleName,
  disciplineId: string | null | undefined,
): Promise<void> {
  if (DISCIPLINE_ROLES.includes(role) && !disciplineId) {
    throw new ServiceError("Choose a discipline for a discipline lead or an engineer.", {
      disciplineId: ["Choose a discipline for a discipline lead or an engineer."],
    });
  }
  if (!disciplineId) return;

  const discipline = await prisma.discipline.findUnique({
    where: { id: disciplineId },
    select: { id: true },
  });
  if (!discipline) throw new NotFoundError("We could not find that discipline.");
}

/** Creates an account. There is no signup — this is the only way a person gets into the app. */
export async function createUser(actor: ActorContext, input: CreateUserInput): Promise<UserDTO> {
  assertCan(actor, "MANAGE_USERS");

  const clash = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (clash) {
    throw new ServiceError("A user with this email already exists.", {
      email: ["A user with this email already exists."],
    });
  }

  await assertDisciplineChoice(input.role, input.disciplineId);
  const passwordHash = await hashPassword(input.password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role,
        disciplineId: input.disciplineId ?? null,
        jobTitle: input.jobTitle ?? null,
      },
      select: USER_SELECT,
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "User",
      entityId: user.id,
      action: ACTIVITY.USER_CREATED,
      summary: `${actor.name} created an account for ${user.name}`,
      metadata: { role: user.role, disciplineId: user.disciplineId },
    });

    return user;
  });

  return checkDto(UserSchema, toUserDTO(created), "UserDTO");
}

/** Changes someone's details. A new password may be set here; it is only ever stored hashed. */
export async function updateUser(actor: ActorContext, input: UpdateUserInput): Promise<UserDTO> {
  assertCan(actor, "MANAGE_USERS");

  const existing = await prisma.user.findUnique({ where: { id: input.id }, select: USER_SELECT });
  if (!existing) throw new NotFoundError("We could not find that person.");

  const nextRole = input.role ?? existing.role;
  const nextDisciplineId =
    input.disciplineId === undefined ? existing.disciplineId : input.disciplineId;
  await assertDisciplineChoice(nextRole, nextDisciplineId);

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
    const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
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

  const existing = await prisma.user.findUnique({ where: { id: input.id }, select: USER_SELECT });
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

  const clash = await prisma.discipline.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (clash) {
    throw new ServiceError("A discipline with this code already exists.", {
      code: ["A discipline with this code already exists."],
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const discipline = await tx.discipline.create({
      data: {
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

  const existing = await prisma.discipline.findUnique({ where: { id: input.id } });
  if (!existing) throw new NotFoundError("We could not find that discipline.");

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
