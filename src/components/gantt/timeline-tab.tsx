// The Timeline tab, in its three homes: a whole project, one main task and its disciplines, or the
// signed-in person's own work on the My tasks screen. All three fetch the same GanttDTO and hand it
// to the same chart.

"use client";

import dynamic from "next/dynamic";
import {
  useMainTaskSchedule,
  useMe,
  useMyTasksGantt,
  useProject,
  useProjectGantt,
} from "@/components/hooks/use-api";
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
  readOnly = false,
}: {
  gantt: GanttDTO | undefined;
  project: ProjectDTO | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  queryKey: readonly unknown[];
  emptyMessage: string;
  /** Look, don't touch — no bar can be dragged or edited. */
  readOnly?: boolean;
}) {
  const me = useMe();

  if (isError) return <ErrorBanner message={LOAD_ERROR} onRetry={onRetry} />;
  if (isPending || !gantt) return <SkeletonRows rows={6} />;
  if (gantt.mainTasks.length === 0) return <EmptyState message={emptyMessage} />;

  // The chart works out row by row whether a bar may be dragged, from who you are and what the
  // project says (`editable` on each row). Leaving both out is what makes a schedule read-only —
  // no viewer means no permission on any row, so no bar moves and no edit dialog opens.
  return (
    <GanttChart
      gantt={gantt}
      project={readOnly ? undefined : project}
      me={readOnly ? undefined : me.data}
      queryKey={queryKey}
    />
  );
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

/**
 * The signed-in person's own discipline work, under the main tasks it belongs to. Read-only: this
 * is a view of your workload, and dates are changed on the project or task that owns them.
 */
export function MyTasksTimeline() {
  const gantt = useMyTasksGantt();

  return (
    <Schedule
      gantt={gantt.data}
      project={undefined}
      isPending={gantt.isPending}
      isError={gantt.isError}
      onRetry={() => void gantt.refetch()}
      queryKey={["my-tasks", "gantt"]}
      emptyMessage="Nothing assigned to you to schedule yet."
      readOnly
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
