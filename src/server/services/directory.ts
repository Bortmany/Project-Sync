// The two pickers every form needs: the discipline catalogue and the people directory.
// Both are readable by anyone signed in — but only ever inside their own company. Neither exposes a
// password hash or a session, and neither can see a person or a discipline in another organisation.

import { prisma } from "@/lib/db";
import type { DisciplineDTO, UserDTO } from "@/lib/zod-schemas";
import { DisciplineDTO as DisciplineSchema, UserDTO as UserSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { checkDtoList } from "@/server/serialize";

const USER_LIMIT = 50;

/** Every discipline this company runs, in the order it lists them. */
export async function listDisciplines(actor: ActorContext): Promise<DisciplineDTO[]> {
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

/**
 * Active colleagues, optionally narrowed by a name or email fragment. Capped so a picker stays
 * quick — and filtered to the actor's own company, which is what stops the people directory (and
 * the search box that reuses it) from ever showing someone from another customer.
 */
export async function listUsers(actor: ActorContext, query?: string): Promise<UserDTO[]> {
  const needle = query?.trim();
  const rows = await prisma.user.findMany({
    where: {
      orgId: actor.orgId,
      isActive: true,
      ...(needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" as const } },
              { email: { contains: needle, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: USER_LIMIT,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      disciplineId: true,
      jobTitle: true,
      isActive: true,
      createdAt: true,
      discipline: { select: { code: true } },
    },
  });

  const items = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disciplineId: row.disciplineId,
    disciplineCode: row.discipline?.code ?? null,
    jobTitle: row.jobTitle,
    isActive: row.isActive,
    createdAt: row.createdAt,
  }));

  return checkDtoList(UserSchema, items, "UserDTO");
}
