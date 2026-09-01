// Typed read hooks. Every screen's data comes through here: fetch a contract route, unwrap the
// { ok, data } envelope, and parse it with the DTO schema from src/lib/zod-schemas.

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  ActivityItemDTO,
  BoardPostDTO,
  BriefDTO,
  CommentDTO,
  DashboardDTO,
  DisciplineDTO,
  DisciplineTaskDTO,
  DocumentDTO,
  DocumentVersionDTO,
  GanttDTO,
  MainTaskDTO,
  MainTaskListItemDTO,
  MicrosoftStatusDTO,
  MyTasksDTO,
  PersonalTaskDTO,
  PhaseDTO,
  PostAudienceDTO,
  PostDTO,
  ProjectBriefDTO,
  ProjectDTO,
  ProjectListItemDTO,
  SearchResultsDTO,
  UserDTO,
  type ProjectMemberDTO,
  type RoleName,
} from "@/lib/zod-schemas";

/** The signed-in person as /api/auth/me returns them — a subset of the shared UserDTO shape. */
export const MeDTO = UserDTO.pick({
  id: true,
  email: true,
  name: true,
  role: true,
  disciplineId: true,
  jobTitle: true,
});
export type MeDTO = z.infer<typeof MeDTO>;

/**
 * A comment as a thread row: the shared CommentDTO plus the flag that says "this one was removed",
 * which the list renders as a muted tombstone. The server adds the same field in
 * src/server/services/comments.ts.
 */
export const CommentRowDTO = CommentDTO.extend({ isDeleted: z.boolean() });
export type CommentRowDTO = z.infer<typeof CommentRowDTO>;

/**
 * Fetches a contract route, unwraps the `{ ok, data }` envelope and parses the payload. Exported so
 * the notification hooks read routes exactly the same way instead of keeping their own copy.
 */
export async function readRoute<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The server sent something we couldn't read.");
  }

  const envelope = z
    .union([
      z.object({ ok: z.literal(true), data: z.unknown() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ])
    .safeParse(payload);

  if (!envelope.success) throw new Error("The server sent something we couldn't read.");
  if (!envelope.data.ok) throw new Error(envelope.data.error);

  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) throw new Error("The server sent something we couldn't read.");
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Who's signed in                                                     */
/* ------------------------------------------------------------------ */

export function useMe(): UseQueryResult<MeDTO> {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => readRoute("/api/auth/me", MeDTO),
    staleTime: 5 * 60_000,
  });
}

/** Roles allowed to create projects, main tasks and manage a project's team. */
export function isManager(me: MeDTO | undefined): boolean {
  return me?.role === "ADMIN" || me?.role === "PROJECT_MANAGER";
}

/**
 * A contractor from another company. The server narrows everything they read anyway; this is only
 * so the screens do not offer them tabs and buttons that would come back empty or refused.
 */
export function isExternalUser(me: MeDTO | undefined): boolean {
  return me?.role === "EXTERNAL";
}

/** Roles allowed to steer work inside a discipline (plus the task's own assignee). */
export function isLeadOrAbove(me: MeDTO | undefined): boolean {
  return isManager(me) || me?.role === "DISCIPLINE_LEAD";
}

/* ------------------------------------------------------------------ */
/* What someone may do inside ONE project                              */
/* ------------------------------------------------------------------ */
// The server decides by the person's membership of that project, not by their org-wide role
// (src/server/authz.ts). The helpers below read the same membership out of ProjectDTO so the UI
// offers the same buttons the server would accept. They are a courtesy, never the check itself.

/** The signed-in person's own membership row on this project, if they have one. */
export function membershipIn(
  me: MeDTO | undefined,
  project: ProjectDTO | undefined,
): ProjectMemberDTO | undefined {
  if (!me || !project) return undefined;
  return project.members.find((member) => member.userId === me.id);
}

/**
 * The role that actually applies inside this project. A global administrator always keeps their
 * reach; everyone else is whatever their membership row says. Undefined means "not a member" —
 * treat that as no extra powers.
 */
export function projectRoleOf(
  me: MeDTO | undefined,
  project: ProjectDTO | undefined,
): RoleName | undefined {
  if (me?.role === "ADMIN") return "ADMIN";
  return membershipIn(me, project)?.projectRole;
}

/** May manage this project: create and edit its tasks, override a status, change the team. */
export function isManagerOn(me: MeDTO | undefined, project: ProjectDTO | undefined): boolean {
  const role = projectRoleOf(me, project);
  return role === "ADMIN" || role === "PROJECT_MANAGER";
}

/**
 * May steer work in this project. A discipline lead only counts for their own discipline, so pass
 * the task's discipline when the control belongs to one (reassigning, editing a discipline task).
 */
export function isLeadOrAboveOn(
  me: MeDTO | undefined,
  project: ProjectDTO | undefined,
  disciplineId?: string,
): boolean {
  if (isManagerOn(me, project)) return true;
  const membership = membershipIn(me, project);
  if (membership?.projectRole !== "DISCIPLINE_LEAD") return false;
  if (!disciplineId) return true;
  return membership.disciplineId === disciplineId;
}

/* ------------------------------------------------------------------ */
/* Catalogues                                                          */
/* ------------------------------------------------------------------ */

export function useDisciplines(): UseQueryResult<DisciplineDTO[]> {
  return useQuery({
    queryKey: ["disciplines"],
    queryFn: () => readRoute("/api/disciplines", z.array(DisciplineDTO)),
    staleTime: 5 * 60_000,
  });
}

export function useUsers(query: string, enabled = true): UseQueryResult<UserDTO[]> {
  return useQuery({
    queryKey: ["users", query],
    queryFn: () => readRoute(`/api/users?q=${encodeURIComponent(query)}`, z.array(UserDTO)),
    enabled,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

export function useDashboard(): UseQueryResult<DashboardDTO> {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => readRoute("/api/dashboard", DashboardDTO),
  });
}

/**
 * Everything assigned to the signed-in person, completed work included, with true counts per status.
 * The dashboard keeps its own smaller feed (useDashboard) — this is the My tasks screen's own route.
 */
export function useMyTasks(): UseQueryResult<MyTasksDTO> {
  return useQuery({
    queryKey: ["my-tasks"],
    queryFn: () => readRoute("/api/my-tasks", MyTasksDTO),
  });
}

/** The same personal work as a schedule, for the read-only Timeline view of My tasks. */
export function useMyTasksGantt(enabled = true): UseQueryResult<GanttDTO> {
  return useQuery({
    queryKey: ["my-tasks", "gantt"],
    queryFn: () => readRoute("/api/my-tasks/gantt", GanttDTO),
    enabled,
  });
}

/**
 * "Your day": the signed-in person's brief, computed on the server. Everything in it is worked out
 * from work the app already records, so it is only ever as fresh as the page.
 */
export function useMyBrief(): UseQueryResult<BriefDTO> {
  return useQuery({
    queryKey: ["my-tasks", "brief"],
    queryFn: () => readRoute("/api/my-tasks/brief", BriefDTO),
  });
}

/** The private scratchpad list: open items first, then the ones already ticked off. */
export function usePersonalTasks(): UseQueryResult<PersonalTaskDTO[]> {
  return useQuery({
    queryKey: PERSONAL_TASKS_KEY,
    queryFn: () => readRoute("/api/personal-tasks", z.array(PersonalTaskDTO)),
  });
}

/** One key for the personal list, so every add, tick and delete refreshes the same query. */
export const PERSONAL_TASKS_KEY = ["personal-tasks"] as const;

export function useProjects(): UseQueryResult<ProjectListItemDTO[]> {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => readRoute("/api/projects", z.array(ProjectListItemDTO)),
  });
}

export function useProject(projectId: string): UseQueryResult<ProjectDTO> {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => readRoute(`/api/projects/${projectId}`, ProjectDTO),
    enabled: projectId.length > 0,
  });
}

/** "Where we stand": one project's brief, computed on the server. Every member may read it. */
export function useProjectBrief(projectId: string): UseQueryResult<ProjectBriefDTO> {
  return useQuery({
    queryKey: ["project", projectId, "brief"],
    queryFn: () => readRoute(`/api/projects/${projectId}/brief`, ProjectBriefDTO),
    enabled: projectId.length > 0,
  });
}

/**
 * A project's stage gates. `locked` arrives derived from the server — the UI never works it out for
 * itself, and hiding a control is a courtesy: the refusal that matters is the server's.
 */
export function usePhases(projectId: string): UseQueryResult<PhaseDTO[]> {
  return useQuery({
    queryKey: ["project", projectId, "phases"],
    queryFn: () => readRoute(`/api/projects/${projectId}/phases`, z.array(PhaseDTO)),
    enabled: projectId.length > 0,
  });
}

export type MainTaskFilters = {
  status?: string[];
  disciplineId?: string[];
  assigneeId?: string[];
  priority?: string[];
  q?: string;
};

function toQueryString(filters: MainTaskFilters): string {
  const params = new URLSearchParams();
  for (const value of filters.status ?? []) params.append("status", value);
  for (const value of filters.disciplineId ?? []) params.append("disciplineId", value);
  for (const value of filters.assigneeId ?? []) params.append("assigneeId", value);
  for (const value of filters.priority ?? []) params.append("priority", value);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useProjectMainTasks(
  projectId: string,
  filters: MainTaskFilters,
): UseQueryResult<MainTaskListItemDTO[]> {
  return useQuery({
    queryKey: ["project", projectId, "main-tasks", filters],
    queryFn: () =>
      readRoute(
        `/api/projects/${projectId}/main-tasks${toQueryString(filters)}`,
        z.array(MainTaskListItemDTO),
      ),
  });
}

export function useMainTask(taskId: string): UseQueryResult<MainTaskDTO> {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => readRoute(`/api/tasks/${taskId}`, MainTaskDTO),
  });
}

/**
 * The main task's schedule feed. It is the only contract route that carries the discipline tasks'
 * own ids, which the discipline progress cards need to link through to each engineer's page.
 */
export function useMainTaskSchedule(taskId: string): UseQueryResult<GanttDTO> {
  return useQuery({
    queryKey: ["task", taskId, "gantt"],
    queryFn: () => readRoute(`/api/tasks/${taskId}/gantt`, GanttDTO),
  });
}

/** The whole project's schedule, for the Timeline tab. */
export function useProjectGantt(projectId: string): UseQueryResult<GanttDTO> {
  return useQuery({
    queryKey: ["project", projectId, "gantt"],
    queryFn: () => readRoute(`/api/projects/${projectId}/gantt`, GanttDTO),
    enabled: projectId.length > 0,
  });
}

export function useMainTaskActivity(taskId: string): UseQueryResult<ActivityItemDTO[]> {
  return useQuery({
    queryKey: ["task", taskId, "activity"],
    queryFn: () => readRoute(`/api/tasks/${taskId}/activity`, z.array(ActivityItemDTO)),
  });
}

export function useDisciplineTask(taskId: string): UseQueryResult<DisciplineTaskDTO> {
  return useQuery({
    queryKey: ["discipline-task", taskId],
    queryFn: () => readRoute(`/api/discipline-tasks/${taskId}`, DisciplineTaskDTO),
  });
}

export function useDisciplineTaskActivity(taskId: string): UseQueryResult<ActivityItemDTO[]> {
  return useQuery({
    queryKey: ["discipline-task", taskId, "activity"],
    queryFn: () =>
      readRoute(`/api/discipline-tasks/${taskId}/activity`, z.array(ActivityItemDTO)),
  });
}

export function useProjectActivity(projectId: string): UseQueryResult<ActivityItemDTO[]> {
  return useQuery({
    queryKey: ["project", projectId, "activity"],
    queryFn: () => readRoute(`/api/projects/${projectId}/activity`, z.array(ActivityItemDTO)),
    enabled: projectId.length > 0,
  });
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */
// Each list sits under its owner's query key, so invalidating ["task", id] or
// ["discipline-task", id] after an upload refreshes the documents with everything else.

export function useMainTaskDocuments(taskId: string): UseQueryResult<DocumentDTO[]> {
  return useQuery({
    queryKey: ["task", taskId, "documents"],
    queryFn: () => readRoute(`/api/tasks/${taskId}/documents`, z.array(DocumentDTO)),
  });
}

export function useDisciplineTaskDocuments(taskId: string): UseQueryResult<DocumentDTO[]> {
  return useQuery({
    queryKey: ["discipline-task", taskId, "documents"],
    queryFn: () => readRoute(`/api/discipline-tasks/${taskId}/documents`, z.array(DocumentDTO)),
  });
}

export function useProjectDocuments(projectId: string): UseQueryResult<DocumentDTO[]> {
  return useQuery({
    queryKey: ["project", projectId, "documents"],
    queryFn: () => readRoute(`/api/projects/${projectId}/documents`, z.array(DocumentDTO)),
    enabled: projectId.length > 0,
  });
}

/** Every revision of one document, newest first. Only fetched while the history panel is open. */
export function useDocumentVersions(
  documentId: string,
  enabled = true,
): UseQueryResult<DocumentVersionDTO[]> {
  return useQuery({
    queryKey: ["document", documentId, "versions"],
    queryFn: () => readRoute(`/api/documents/${documentId}/versions`, z.array(DocumentVersionDTO)),
    enabled: enabled && documentId.length > 0,
  });
}

/* ------------------------------------------------------------------ */
/* Global search                                                       */
/* ------------------------------------------------------------------ */

/** The shortest query the search route accepts — the same rule as src/lib/search.ts. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * One search, shared by the topbar dropdown and the /search page: the same query key means typing
 * in the topbar and then opening the full page does not fetch twice.
 */
export function useSearch(query: string): UseQueryResult<SearchResultsDTO> {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => readRoute(`/api/search?q=${encodeURIComponent(trimmed)}`, SearchResultsDTO),
    enabled: trimmed.length >= MIN_SEARCH_LENGTH,
    staleTime: 30_000,
  });
}

/** How many results a set carries, across every group. */
export function countResults(results: SearchResultsDTO | undefined): number {
  if (!results) return 0;
  return (
    results.projects.length +
    results.mainTasks.length +
    results.disciplineTasks.length +
    results.users.length +
    results.documents.length
  );
}

/* ------------------------------------------------------------------ */
/* Comment threads                                                     */
/* ------------------------------------------------------------------ */

export function useMainTaskComments(taskId: string): UseQueryResult<CommentRowDTO[]> {
  return useQuery({
    queryKey: ["task", taskId, "comments"],
    queryFn: () => readRoute(`/api/tasks/${taskId}/comments`, z.array(CommentRowDTO)),
  });
}

export function useDisciplineTaskComments(taskId: string): UseQueryResult<CommentRowDTO[]> {
  return useQuery({
    queryKey: ["discipline-task", taskId, "comments"],
    queryFn: () =>
      readRoute(`/api/discipline-tasks/${taskId}/comments`, z.array(CommentRowDTO)),
  });
}

/* ------------------------------------------------------------------ */
/* Microsoft 365 files                                                 */
/* ------------------------------------------------------------------ */

/**
 * Is "Attach from OneDrive or SharePoint" available to this person? The route answers
 * `{ configured: false }` with a 200 while the feature is dormant (no Azure app registered), so the
 * ordinary "nobody has switched this on" case is read like any other answer instead of being caught
 * as an error. The catch is still here for a genuine problem — offline, a 401, a 429 — and answers
 * null, which keeps the tab out of sight rather than showing a broken one. Cached for five minutes:
 * it changes about once a year.
 */
export function useMicrosoftStatus(): UseQueryResult<MicrosoftStatusDTO | null> {
  return useQuery({
    queryKey: ["microsoft-status"],
    queryFn: async () => {
      try {
        return await readRoute("/api/integrations/microsoft/status", MicrosoftStatusDTO);
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* The noticeboard                                                     */
/* ------------------------------------------------------------------ */

/**
 * The announcements still running for this person. Used twice: the dashboard strip (which hides the
 * ones they have dismissed) and the Messages page (which does not).
 *
 * `retry: false` on purpose — the dashboard strip fails silently rather than planting a red banner
 * above somebody's actual work, so there is nothing to gain from trying again behind their back.
 */
export function useAnnouncements(enabled = true): UseQueryResult<PostDTO[]> {
  return useQuery({
    queryKey: ["announcements"],
    queryFn: () => readRoute("/api/posts/announcements", z.array(PostDTO)),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** The tabs this person may read, each saying whether they may post or moderate there. */
export function usePostAudiences(enabled = true): UseQueryResult<PostAudienceDTO[]> {
  return useQuery({
    queryKey: ["post-audiences"],
    queryFn: () => readRoute("/api/posts/audiences", z.array(PostAudienceDTO)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** One board's conversations, newest first, each with its replies. */
export function useBoard(tab: string, enabled = true): UseQueryResult<BoardPostDTO[]> {
  return useQuery({
    queryKey: ["board", tab],
    queryFn: () =>
      readRoute(`/api/posts/board?tab=${encodeURIComponent(tab)}`, z.array(BoardPostDTO)),
    enabled: enabled && tab.length > 0,
  });
}
