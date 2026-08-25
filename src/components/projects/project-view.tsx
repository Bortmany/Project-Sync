// Project overview: the header block, then Tasks | Gantt | Documents | Team | Activity.

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateProject } from "@/components/actions";
import { ProjectActivity } from "@/components/activity/activity-feeds";
import { ProjectDocumentsTab } from "@/components/documents/project-documents";
import { ProjectTimelineTab } from "@/components/gantt/timeline-tab";
import { ProjectStatusBadge } from "@/components/projects/projects-view";
import { ProjectTasksTab } from "@/components/projects/project-tasks-tab";
import { ProjectTeamTab } from "@/components/projects/project-team-tab";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { isManager, isManagerOn, useMe, useProject } from "@/components/hooks/use-api";
import { FavoriteStar } from "@/components/shell/favorite-star";
import { formatDate, toDateInputValue } from "@/components/format";
import {
  Breadcrumb,
  Button,
  DateInput,
  DisciplineDot,
  ErrorBanner,
  Field,
  Input,
  Modal,
  ProgressBar,
  Select,
  Skeleton,
  SkeletonRows,
  Tabs,
  Textarea,
} from "@/components/ui";
import type { ProjectDTO, ProjectStatusName } from "@/lib/zod-schemas";

function EditProjectDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectDTO;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { run, pending, error, fieldErrors } = useAction();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectStatusName>(project.status);
  const [startDate, setStartDate] = useState(toDateInputValue(project.startDate));
  const [targetDate, setTargetDate] = useState(toDateInputValue(project.targetDate));

  const dateOrderError =
    startDate && targetDate && targetDate < startDate
      ? "Deadline can't be before the start date."
      : undefined;

  return (
    <Modal
      open={open}
      title="Edit project"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!name.trim() || Boolean(dateOrderError)}
            onClick={() =>
              run(
                () =>
                  updateProject({
                    id: project.id,
                    name: name.trim(),
                    description: description.trim(),
                    status,
                    startDate: startDate ? new Date(startDate) : null,
                    targetDate: targetDate ? new Date(targetDate) : null,
                  }),
                {
                  success: "Project updated.",
                  failure: "Couldn't save these changes. Try again.",
                  onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
                    void queryClient.invalidateQueries({ queryKey: ["projects"] });
                    onClose();
                  },
                },
              )
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message="Couldn't save these changes. Try again." /> : null}
        <Field label="Name" error={fieldError(fieldErrors, "name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Code" hint="The project code can't be changed after creation.">
          <Input value={project.code} disabled readOnly />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date">
            <DateInput value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="Deadline" error={dateOrderError}>
            <DateInput
              value={targetDate}
              min={startDate || undefined}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Status">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatusName)}
          >
            <option value="ACTIVE">Active</option>
            <option value="ON_HOLD">On hold</option>
            <option value="COMPLETED">Completed</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

export function ProjectView({ projectId }: { projectId: string }) {
  const me = useMe();
  const project = useProject(projectId);
  const [editOpen, setEditOpen] = useState(false);

  if (project.isError) {
    return (
      <ErrorBanner
        message="Couldn't load this project. Try refreshing the page."
        onRetry={() => void project.refetch()}
      />
    );
  }

  if (project.isPending || !project.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-80" />
        <Skeleton className="h-3 w-64" />
        <SkeletonRows rows={6} />
      </div>
    );
  }

  const data = project.data;
  const canManage = isManager(me.data);

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: "Projects", href: "/projects" }, { label: data.name }]} />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--olng-blue)]">{data.name}</h1>
          <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--olng-text)]">
            {data.code}
          </span>
          <ProjectStatusBadge status={data.status} />
          <FavoriteStar targetType="PROJECT" targetId={data.id} />
          {canManage ? (
            <Button variant="ghost" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          ) : null}
        </div>

        <div className="max-w-md space-y-1">
          <p className="text-sm text-[var(--olng-text)]">
            {data.counts.completed} of {data.counts.mainTasks} main tasks complete ·{" "}
            {data.progressPct}%
          </p>
          <ProgressBar pct={data.progressPct} />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--olng-text)]">
          <span>
            {formatDate(data.startDate)} — {formatDate(data.targetDate)}
          </span>
          <span className="inline-flex items-center gap-1">
            {data.disciplines.map((discipline) => (
              <DisciplineDot
                key={discipline.id}
                colorHex={discipline.colorHex}
                code={discipline.code}
              />
            ))}
          </span>
          {data.counts.overdue > 0 ? (
            <span className="font-semibold text-[var(--status-blocked)]">
              {data.counts.overdue} overdue
            </span>
          ) : null}
        </div>
      </header>

      <Tabs
        items={[
          {
            id: "tasks",
            label: "Tasks",
            content: <ProjectTasksTab project={data} canManage={canManage} />,
          },
          {
            id: "gantt",
            label: "Timeline",
            content: <ProjectTimelineTab project={data} />,
          },
          {
            id: "documents",
            label: "Documents",
            content: (
              <ProjectDocumentsTab project={data} canDelete={isManagerOn(me.data, data)} />
            ),
          },
          {
            id: "team",
            label: "Team",
            content: <ProjectTeamTab project={data} canManage={canManage} />,
          },
          {
            id: "activity",
            label: "Activity",
            content: <ProjectActivity projectId={data.id} />,
          },
        ]}
      />

      {canManage ? (
        <EditProjectDialog project={data} open={editOpen} onClose={() => setEditOpen(false)} />
      ) : null}
    </div>
  );
}
