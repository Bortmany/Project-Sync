// One flat shape for every kind of search hit, so the topbar dropdown and the /search page
// render and navigate the same rows in the same order.

import { formatDate } from "@/components/format";
import type { RoleName, SearchResultsDTO } from "@/lib/zod-schemas";

export type SearchGroup = "projects" | "mainTasks" | "disciplineTasks" | "users" | "documents";

export const GROUP_ORDER: SearchGroup[] = [
  "projects",
  "mainTasks",
  "disciplineTasks",
  "users",
  "documents",
];

export const GROUP_LABEL: Record<SearchGroup, string> = {
  projects: "Projects",
  mainTasks: "Main tasks",
  disciplineTasks: "Discipline tasks",
  users: "People",
  documents: "Documents",
};

const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project manager",
  DISCIPLINE_LEAD: "Discipline lead",
  ENGINEER: "Engineer",
};

export type SearchRow = {
  key: string;
  group: SearchGroup;
  title: string;
  /** The short muted line beside the title. */
  meta: string;
  href: string;
  /** People rows open the person's email rather than a page — there are no profile pages. */
  external?: boolean;
  colorHex?: string;
};

/** Where a document lives: its discipline task, its main task, or the project itself. */
function documentHref(document: SearchResultsDTO["documents"][number]): string {
  if (document.disciplineTaskId) return `/discipline-tasks/${document.disciplineTaskId}`;
  if (document.mainTaskId) return `/tasks/${document.mainTaskId}`;
  return `/projects/${document.projectId}`;
}

/** The rows of one group, in the order they are shown. */
export function rowsFor(results: SearchResultsDTO, group: SearchGroup): SearchRow[] {
  if (group === "projects") {
    return results.projects.map((project) => ({
      key: `project-${project.id}`,
      group,
      title: project.name,
      meta: `${project.code} · ${project.mainTaskCount} main ${
        project.mainTaskCount === 1 ? "task" : "tasks"
      }`,
      href: `/projects/${project.id}`,
    }));
  }

  if (group === "mainTasks") {
    return results.mainTasks.map((task) => ({
      key: `main-task-${task.id}`,
      group,
      title: task.title,
      meta: `${task.projectCode} · due ${formatDate(task.deadline)}`,
      href: `/tasks/${task.id}`,
    }));
  }

  if (group === "disciplineTasks") {
    return results.disciplineTasks.map((task) => ({
      key: `discipline-task-${task.id}`,
      group,
      title: task.title,
      meta: `${task.disciplineCode} · due ${formatDate(task.deadline)}`,
      href: `/discipline-tasks/${task.id}`,
    }));
  }

  if (group === "users") {
    return results.users.map((user) => ({
      key: `user-${user.id}`,
      group,
      title: user.name,
      meta: `${ROLE_LABEL[user.role]}${user.disciplineCode ? ` · ${user.disciplineCode}` : ""} · ${user.email}`,
      href: `mailto:${user.email}`,
      external: true,
    }));
  }

  return results.documents.map((document) => ({
    key: `document-${document.id}`,
    group,
    title: document.title,
    meta: document.currentRevision
      ? `Rev ${document.currentRevision.revisionNumber} · ${formatDate(document.createdAt)}`
      : formatDate(document.createdAt),
    href: documentHref(document),
  }));
}

/** Every row across every group, in group order — what the keyboard walks through. */
export function allRows(results: SearchResultsDTO | undefined, perGroup?: number): SearchRow[] {
  if (!results) return [];
  return GROUP_ORDER.flatMap((group) => {
    const rows = rowsFor(results, group);
    return perGroup === undefined ? rows : rows.slice(0, perGroup);
  });
}
