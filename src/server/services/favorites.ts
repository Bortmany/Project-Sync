// A person's own shortcuts in the sidebar: star a project, a main task or a discipline task, and
// see the starred things newest first.
//
// Two rules run through this whole file:
//  1. A favorite is a personal preference, not project work, so **no ActivityLog row is ever
//     written** here — the same documented exception as marking a notification read
//     (docs/CONVENTIONS.md, house rule 1).
//  2. Starring something is still a read of it: you may only favorite a thing you are allowed to
//     see, so every target is resolved to its project and checked with assertCanViewProject.

import { notDeleted, prisma } from "@/lib/db";
import type { FavoriteDTO, FavoriteTargetName, ToggleFavoriteInput } from "@/lib/zod-schemas";
import { FavoriteDTO as FavoriteSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { checkDtoList } from "@/server/serialize";
import { assertCanViewProject, visibleProjects } from "@/server/services/projects";

/** The most shortcuts the sidebar will hold. Older stars stay in the database. */
const LIST_LIMIT = 50;

const NOT_FOUND = "We could not find that, or it has been removed.";

type TargetColumns = {
  projectId?: string;
  mainTaskId?: string;
  disciplineTaskId?: string;
};

/**
 * The one Favorite column this kind of target lives in. Exactly one is ever set — the database
 * refuses anything else through the `favorite_one_target` CHECK constraint.
 */
function targetColumns(targetType: FavoriteTargetName, targetId: string): TargetColumns {
  if (targetType === "PROJECT") return { projectId: targetId };
  if (targetType === "MAIN_TASK") return { mainTaskId: targetId };
  return { disciplineTaskId: targetId };
}

/**
 * The project a target belongs to — and proof that the target is still live AND this person's
 * company owns it. A soft-deleted target, one whose parents are soft-deleted, or one belonging to
 * another organisation is simply "not found": you cannot star what you cannot see.
 */
async function projectIdForTarget(actor: ActorContext, input: ToggleFavoriteInput): Promise<string> {
  if (input.targetType === "PROJECT") {
    const project = await prisma.project.findFirst({
      where: { id: input.targetId, orgId: actor.orgId, ...notDeleted },
      select: { id: true },
    });
    if (!project) throw new NotFoundError(NOT_FOUND);
    return project.id;
  }

  if (input.targetType === "MAIN_TASK") {
    const mainTask = await prisma.mainTask.findFirst({
      where: { id: input.targetId, ...notDeleted, project: { ...notDeleted, orgId: actor.orgId } },
      select: { projectId: true },
    });
    if (!mainTask) throw new NotFoundError(NOT_FOUND);
    return mainTask.projectId;
  }

  const disciplineTask = await prisma.disciplineTask.findFirst({
    where: {
      id: input.targetId,
      ...notDeleted,
      mainTask: { ...notDeleted, project: { ...notDeleted, orgId: actor.orgId } },
    },
    select: { mainTask: { select: { projectId: true } } },
  });
  if (!disciplineTask) throw new NotFoundError(NOT_FOUND);
  return disciplineTask.mainTask.projectId;
}

/**
 * Stars a thing, or un-stars it if it was already starred. One button, one action.
 * Returns where it ended up, so the UI never has to guess.
 */
export async function toggleFavorite(
  actor: ActorContext,
  input: ToggleFavoriteInput,
): Promise<{ favorited: boolean }> {
  const projectId = await projectIdForTarget(actor, input);
  await assertCanViewProject(actor, projectId);

  const target = targetColumns(input.targetType, input.targetId);

  const existing = await prisma.favorite.findFirst({
    where: { userId: actor.userId, ...target },
    select: { id: true },
  });

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return { favorited: false };
  }

  await prisma.favorite.create({ data: { userId: actor.userId, ...target } });
  return { favorited: true };
}

/**
 * This person's shortcuts, newest first. Anything whose target has since been deleted — or now sits
 * in a project this person may no longer see — is left out quietly: a dangling star is not an error
 * worth showing anybody, and a star must never outlive the permission that earned it.
 *
 * The soft-delete helpers in db.ts do not cover this listing (Favorite has no deletedAt of its own
 * and the rows span three different targets), so the filter is applied by hand on each relation,
 * the same way the dashboard does its cross-project reads. Visibility is answered once for the whole
 * listing with `visibleProjects` (an administrator sees every project, as everywhere else) rather
 * than project by project.
 */
export async function listFavorites(actor: ActorContext): Promise<FavoriteDTO[]> {
  const visible = await visibleProjects(actor);

  const rows = await prisma.favorite.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      createdAt: true,
      project: { select: { id: true, name: true, code: true, deletedAt: true } },
      mainTask: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          project: { select: { id: true, code: true, deletedAt: true } },
        },
      },
      disciplineTask: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          mainTask: {
            select: {
              id: true,
              deletedAt: true,
              project: { select: { id: true, code: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });

  const items: FavoriteDTO[] = [];

  for (const row of rows) {
    if (row.project) {
      if (row.project.deletedAt || !visible.has(row.project.id)) continue;
      items.push({
        id: row.id,
        targetType: "PROJECT",
        targetId: row.project.id,
        title: row.project.name,
        projectCode: row.project.code,
        projectId: row.project.id,
        mainTaskId: null,
        createdAt: row.createdAt,
      });
      continue;
    }

    if (row.mainTask) {
      if (row.mainTask.deletedAt || row.mainTask.project.deletedAt) continue;
      if (!visible.has(row.mainTask.project.id)) continue;
      items.push({
        id: row.id,
        targetType: "MAIN_TASK",
        targetId: row.mainTask.id,
        title: row.mainTask.title,
        projectCode: row.mainTask.project.code,
        projectId: row.mainTask.project.id,
        mainTaskId: row.mainTask.id,
        createdAt: row.createdAt,
      });
      continue;
    }

    if (row.disciplineTask) {
      const parent = row.disciplineTask.mainTask;
      if (row.disciplineTask.deletedAt || parent.deletedAt || parent.project.deletedAt) continue;
      if (!visible.has(parent.project.id)) continue;
      items.push({
        id: row.id,
        targetType: "DISCIPLINE_TASK",
        targetId: row.disciplineTask.id,
        title: row.disciplineTask.title,
        projectCode: parent.project.code,
        projectId: parent.project.id,
        mainTaskId: parent.id,
        createdAt: row.createdAt,
      });
    }
  }

  return checkDtoList(FavoriteSchema, items, "FavoriteDTO");
}
