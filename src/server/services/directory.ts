// The two pickers every form needs: the discipline catalogue and the people directory.
// Both are readable by anyone signed in, and neither ever exposes a password hash or a session.

import { prisma } from "@/lib/db";
import type { DisciplineDTO, UserDTO } from "@/lib/zod-schemas";
import { DisciplineDTO as DisciplineSchema, UserDTO as UserSchema } from "@/lib/zod-schemas";
import { checkDtoList } from "@/server/serialize";

const USER_LIMIT = 50;

/** Every discipline, in the order the business lists them. */
export async function listDisciplines(): Promise<DisciplineDTO[]> {
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

/** Active people, optionally narrowed by a name or email fragment. Capped so a picker stays quick. */
export async function listUsers(query?: string): Promise<UserDTO[]> {
  const needle = query?.trim();
  const rows = await prisma.user.findMany({
    where: {
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
