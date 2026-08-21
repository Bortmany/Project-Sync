// The Timeline tab, in its two homes: a whole project, or one main task and its disciplines.
// Both fetch the same GanttDTO and hand it to the same chart.

"use client";

import dynamic from "next/dynamic";
import { useMainTaskSchedule, useMe, useProject, useProjectGantt } from "@/components/hooks/use-api";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui";
import type { GanttDTO, ProjectDTO } from "@/lib/zod-schemas";

// The chart is the heaviest thing in the app (a whole hand-drawn SVG timeline with dragging), and
// it lives behind a tab most visits never open. Loading it only when the tab is actually shown
// keeps it out of the project and task pages' first download.
const GanttChart = dynamic(
  () => import("@/components/gantt/gantt-chart").then((module) => module.GanttChart),
  { ssr: false, loading: () => <SkeletonRows rows={6} /> },
);

const LOAD_ERROR = "Couldn't load the schedule. Try refreshing the page.";

function Schedule({
  gantt,
  project,
  isPending,
  isError,
  onRetry,
  queryKey,
  emptyMessage,
}: {
  gantt: GanttDTO | undefined;
  project: ProjectDTO | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  queryKey: readonly unknown[];
  emptyMessage: string;
}) {
  const me = useMe();

  if (isError) return <ErrorBanner message={LOAD_ERROR} onRetry={onRetry} />;
  if (isPending || !gantt) return <SkeletonRows rows={6} />;
  if (gantt.mainTasks.length === 0) return <EmptyState message={emptyMessage} />;

  return <GanttChart gantt={gantt} project={project} me={me.data} queryKey={queryKey} />;
}

/** Every main task on the project, with its discipline tasks beneath it. */
export function ProjectTimelineTab({ project }: { project: ProjectDTO }) {
  const gantt = useProjectGantt(project.id);

  return (
    <Schedule
      gantt={gantt.data}
      project={project}
      isPending={gantt.isPending}
      isError={gantt.isError}
      onRetry={() => void gantt.refetch()}
      queryKey={["project", project.id, "gantt"]}
      emptyMessage="No tasks to schedule yet. Create a main task to see it on the timeline."
    />
  );
}

/** One main task and the discipline work beneath it. */
export function MainTaskTimelineTab({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const gantt = useMainTaskSchedule(taskId);
  const project = useProject(projectId);

  return (
    <Schedule
      gantt={gantt.data}
      project={project.data}
      isPending={gantt.isPending}
      isError={gantt.isError}
      onRetry={() => void gantt.refetch()}
      queryKey={["task", taskId, "gantt"]}
      emptyMessage="No discipline tasks yet, so there is nothing to schedule."
    />
  );
}
