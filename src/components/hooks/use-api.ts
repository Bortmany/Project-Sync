// Typed read hooks. Every screen's data comes through here: fetch a contract route, unwrap the
// { ok, data } envelope, and parse it with the DTO schema from src/lib/zod-schemas.

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  ActivityItemDTO,
  CommentDTO,
  DashboardDTO,
  DisciplineDTO,
  DisciplineTaskDTO,
  GanttDTO,
  MainTaskDTO,
  MainTaskListItemDTO,
  ProjectDTO,
  ProjectListItemDTO,
  UserDTO,
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

async function readRoute<T>(path: string, schema: z.ZodType<T>): Promise<T> {
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

/** Roles allowed to steer work inside a discipline (plus the task's own assignee). */
export function isLeadOrAbove(me: MeDTO | undefined): boolean {
  return isManager(me) || me?.role === "DISCIPLINE_LEAD";
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
