// A person's private to-do list in the sidebar — jottings that are not project work.
//
// Two rules run through this whole file:
//  1. **Every single where clause is scoped to actor.userId.** Someone else's line is not "refused",
//     it simply does not exist as far as this service is concerned.
//  2. No ActivityLog row is written here. A private list is a personal preference, not project work
//     — the same documented exception as marking a notification read (house rule 1).

import { prisma } from "@/lib/db";
import type {
  CreatePersonalTaskInput,
  DeletePersonalTaskInput,
  PersonalTaskDTO,
  TogglePersonalTaskInput,
} from "@/lib/zod-schemas";
import { PersonalTaskDTO as PersonalTaskSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";

/** The longest list the sidebar will hold. */
const LIST_LIMIT = 200;

const NOT_FOUND = "We could not find that item on your list.";

type PersonalTaskRow = {
  id: string;
  title: string;
  done: boolean;
  completedAt: Date | null;
  createdAt: Date;
};

function toDTO(row: PersonalTaskRow): PersonalTaskDTO {
  return {
    id: row.id,
    title: row.title,
    done: row.done,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

const SELECT = { id: true, title: true, done: true, completedAt: true, createdAt: true } as const;

/**
 * This person's list: still-open items first, newest first, then the done ones with the most
 * recently finished at the top.
 */
export async function listPersonalTasks(actor: ActorContext): Promise<PersonalTaskDTO[]> {
  const rows = await prisma.personalTask.findMany({
    where: { userId: actor.userId },
    // `done` sorts false before true in Postgres, so open items lead. Inside each group:
    // most recently finished first for the done ones, newest first for the open ones (whose
    // completedAt is always null, so that key does nothing to them).
    orderBy: [{ done: "asc" }, { completedAt: "desc" }, { createdAt: "desc" }],
    take: LIST_LIMIT,
    select: SELECT,
  });

  return checkDtoList(PersonalTaskSchema, rows.map(toDTO), "PersonalTaskDTO");
}

/** Adds a line to this person's own list. New lines go to the top. */
export async function createPersonalTask(
  actor: ActorContext,
  input: CreatePersonalTaskInput,
): Promise<PersonalTaskDTO> {
  const lowest = await prisma.personalTask.aggregate({
    where: { userId: actor.userId },
    _min: { sortOrder: true },
  });

  const row = await prisma.personalTask.create({
    data: {
      userId: actor.userId,
      title: input.title,
      sortOrder: (lowest._min.sortOrder ?? 0) - 1,
    },
    select: SELECT,
  });

  return checkDto(PersonalTaskSchema, toDTO(row), "PersonalTaskDTO");
}

/** Ticks a line off, or puts it back. Ticking stamps the time; un-ticking clears it. */
export async function togglePersonalTask(
  actor: ActorContext,
  input: TogglePersonalTaskInput,
): Promise<PersonalTaskDTO> {
  const existing = await prisma.personalTask.findFirst({
    where: { id: input.id, userId: actor.userId },
    select: { id: true, done: true },
  });
  if (!existing) throw new NotFoundError(NOT_FOUND);

  const done = !existing.done;
  const row = await prisma.personalTask.update({
    where: { id: existing.id },
    data: { done, completedAt: done ? new Date() : null },
    select: SELECT,
  });

  return checkDto(PersonalTaskSchema, toDTO(row), "PersonalTaskDTO");
}

/**
 * Removes a line for good. Nothing is soft-deleted here: a private jotting carries no audit trail
 * and no revisions, so there is nothing to keep.
 */
export async function deletePersonalTask(
  actor: ActorContext,
  input: DeletePersonalTaskInput,
): Promise<{ removed: true }> {
  const existing = await prisma.personalTask.findFirst({
    where: { id: input.id, userId: actor.userId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError(NOT_FOUND);

  await prisma.personalTask.delete({ where: { id: existing.id } });
  return { removed: true };
}
