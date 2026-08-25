// Global search: one query per kind of thing, all of them limited to the projects the signed-in
// person may see. An administrator searches every project; everyone else searches only the projects
// they are a member of, so a search can never reveal work someone is not on.
//
// The queries use case-insensitive "contains" (Postgres ILIKE), which the trigram indexes added in
// prisma/migrations/20260820173145_search_trgm_indexes keep quick on partial words.

import { activeProjects, activeProjectsForUser, notDeleted, prisma } from "@/lib/db";
import type { SearchResultsDTO } from "@/lib/zod-schemas";
import { SearchResultsDTO as SearchResultsSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { checkDto } from "@/server/serialize";
import { listUsers } from "@/server/services/directory";
import { toDocumentDTOs } from "@/server/services/documents";
import { buildProjectListItems } from "@/server/services/projects";
import { listMainTaskItems } from "@/server/services/tasks";

/** The shortest query worth running — one letter would match half the database. */
export const MIN_QUERY_LENGTH = 2;

/** How many rows any one group can return. The dropdown shows three; the page shows the rest. */
const PER_GROUP = 20;

function emptyResults(): SearchResultsDTO {
  return { projects: [], mainTasks: [], disciplineTasks: [], users: [], documents: [] };
}

/** Everything matching one query, grouped. Nothing here is visible outside the person's projects. */
export async function searchEverything(
  actor: ActorContext,
  query: string,
): Promise<SearchResultsDTO> {
  const needle = query.trim();
  if (needle.length < MIN_QUERY_LENGTH) {
    return checkDto(SearchResultsSchema, emptyResults(), "SearchResultsDTO");
  }

  // The scope: the same projects the projects list would show this person.
  const visibleProjects =
    actor.role === "ADMIN" ? await activeProjects() : await activeProjectsForUser(actor.userId);
  const projectIds = visibleProjects.map((project) => project.id);

  const like = { contains: needle, mode: "insensitive" as const };

  // Cross-project reads: the soft-delete filter from db.ts is applied by hand here because the
  // per-project helpers would mean one query per project (the dashboard does the same).
  const [projectRows, mainTaskRows, disciplineTaskRows, documentRows, users] = await Promise.all([
    projectIds.length === 0
      ? []
      : prisma.project.findMany({
          where: { id: { in: projectIds }, ...notDeleted, OR: [{ name: like }, { code: like }] },
          orderBy: { createdAt: "desc" },
          take: PER_GROUP,
          select: { id: true, name: true, code: true, status: true, targetDate: true },
        }),
    projectIds.length === 0
      ? []
      : prisma.mainTask.findMany({
          where: {
            projectId: { in: projectIds },
            ...notDeleted,
            OR: [{ title: like }, { description: like }],
          },
          orderBy: { deadline: "asc" },
          take: PER_GROUP,
          select: { id: true },
        }),
    projectIds.length === 0
      ? []
      : prisma.disciplineTask.findMany({
          where: {
            ...notDeleted,
            title: like,
            mainTask: { projectId: { in: projectIds }, ...notDeleted },
          },
          orderBy: { deadline: "asc" },
          take: PER_GROUP,
          include: {
            discipline: { select: { code: true } },
            mainTask: { select: { id: true, projectId: true } },
          },
        }),
    projectIds.length === 0
      ? []
      : prisma.document.findMany({
          where: { projectId: { in: projectIds }, ...notDeleted, title: like },
          orderBy: { createdAt: "desc" },
          take: PER_GROUP,
          select: {
            id: true,
            projectId: true,
            mainTaskId: true,
            disciplineTaskId: true,
            title: true,
            category: true,
            currentVersionId: true,
            uploadedById: true,
            createdAt: true,
          },
        }),
    // People are a shared directory, readable by anyone signed in (same rule as /api/users).
    listUsers(needle),
  ]);

  const [projects, mainTasks, documents] = await Promise.all([
    buildProjectListItems(projectRows),
    listMainTaskItems(mainTaskRows.map((row) => row.id)),
    toDocumentDTOs(documentRows),
  ]);

  const results: SearchResultsDTO = {
    projects,
    mainTasks,
    disciplineTasks: disciplineTaskRows.map((row) => ({
      id: row.id,
      title: row.title,
      mainTaskId: row.mainTask.id,
      projectId: row.mainTask.projectId,
      disciplineCode: row.discipline.code,
      status: row.status,
      deadline: row.deadline,
    })),
    users: users.slice(0, PER_GROUP),
    documents,
  };

  return checkDto(SearchResultsSchema, results, "SearchResultsDTO");
}
