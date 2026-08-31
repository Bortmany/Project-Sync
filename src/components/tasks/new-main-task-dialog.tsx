// New main task — one continuous form: details, the disciplines involved, and what each of them
// must deliver. Creating it also creates every discipline task in one pass.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createMainTask } from "@/components/actions";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { toDateInputValue } from "@/components/format";
import {
  Button,
  DateInput,
  DisciplineDot,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import type { PriorityName, ProjectDTO } from "@/lib/zod-schemas";

type RequiredDocRow = { key: string; name: string; isMandatory: boolean };
type DisciplineRow = {
  assigneeId: string;
  deadline: string;
  isMandatory: boolean;
  documents: RequiredDocRow[];
};

const PRIORITIES: { value: PriorityName; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

function newKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function NewMainTaskDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectDTO;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { run, pending, error, fieldErrors } = useAction();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<PriorityName>("MEDIUM");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [rows, setRows] = useState<Record<string, DisciplineRow>>({});

  const dateOrderError =
    startDate && deadline && deadline < startDate
      ? "Deadline can't be before the start date."
      : undefined;

  const selected = Object.entries(rows);
  const everyoneAssigned = selected.every(([, row]) => row.assigneeId.length > 0);
  const canSubmit =
    Boolean(title.trim()) && Boolean(deadline) && !dateOrderError && selected.length > 0 && everyoneAssigned;

  function membersFor(disciplineId: string) {
    return project.members.filter((member) => member.disciplineId === disciplineId);
  }

  function toggleDiscipline(disciplineId: string) {
    setRows((current) => {
      if (current[disciplineId]) {
        const next = { ...current };
        delete next[disciplineId];
        return next;
      }
      return {
        ...current,
        [disciplineId]: {
          assigneeId: "",
          deadline: deadline,
          isMandatory: true,
          documents: [],
        },
      };
    });
  }

  function patchRow(disciplineId: string, patch: Partial<DisciplineRow>) {
    setRows((current) => ({ ...current, [disciplineId]: { ...current[disciplineId], ...patch } }));
  }

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setStartDate("");
    setDeadline("");
    setOwnerId("");
    setRows({});
  }

  function submit() {
    const disciplineTasks = selected.map(([disciplineId, row]) => {
      const discipline = project.disciplines.find((item) => item.disciplineId === disciplineId);
      return {
        disciplineId,
        title: `${discipline?.name ?? "Discipline"} — ${title.trim()}`,
        description: "",
        assigneeId: row.assigneeId || null,
        deadline: new Date(row.deadline || deadline),
        isMandatory: row.isMandatory,
        requiredDocuments: row.documents
          .filter((document) => document.name.trim().length > 0)
          .map((document) => ({ name: document.name.trim(), isMandatory: document.isMandatory })),
      };
    });

    run(
      () =>
        createMainTask({
          projectId: project.id,
          title: title.trim(),
          description: description.trim(),
          priority,
          startDate: startDate ? new Date(startDate) : null,
          deadline: new Date(deadline),
          ownerId: ownerId || null,
          disciplineTasks,
        }),
      {
        success: `Main task '${title.trim()}' created with ${disciplineTasks.length} discipline task${
          disciplineTasks.length === 1 ? "" : "s"
        }.`,
        failure: "Couldn't create this task. Try again.",
        onSuccess: (task) => {
          void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          reset();
          onClose();
          router.push(`/tasks/${task.id}`);
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`New main task — ${project.name}`}
      footer={
        <div className="flex flex-col items-end gap-1">
          <Button onClick={submit} loading={pending} disabled={!canSubmit}>
            {pending ? "Creating…" : "Create main task"}
          </Button>
          {selected.length > 0 && !everyoneAssigned ? (
            <span className="text-xs text-[var(--brand-gray)]">
              Add an assignee for each selected discipline to continue.
            </span>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {error ? <ErrorBanner message="Couldn't create this task. Try again." /> : null}

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
            Details
          </h3>
          <Field label="Title" error={fieldError(fieldErrors, "title")}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Priority">
              <Select
                value={priority}
                onChange={(event) => setPriority(event.target.value as PriorityName)}
              >
                {PRIORITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start date">
              <DateInput value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label="Deadline" error={dateOrderError ?? fieldError(fieldErrors, "deadline")}>
              <DateInput
                value={deadline}
                min={startDate || undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setDeadline(value);
                  setRows((current) => {
                    const next: Record<string, DisciplineRow> = {};
                    for (const [id, row] of Object.entries(current)) {
                      next[id] = { ...row, deadline: row.deadline || value };
                    }
                    return next;
                  });
                }}
              />
            </Field>
          </div>
          <Field label="Owner">
            <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">No owner yet</option>
              {project.members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userName}
                </option>
              ))}
            </Select>
          </Field>
        </section>

        <section className="space-y-3 border-t border-[var(--border)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
            Disciplines involved
          </h3>
          {project.disciplines.length === 0 ? (
            <p className="text-sm text-[var(--brand-text)]">
              No disciplines on this project yet — add them in the Team tab first.
            </p>
          ) : null}
          {project.disciplines.map((discipline) => {
            const members = membersFor(discipline.disciplineId);
            const row = rows[discipline.disciplineId];
            return (
              <div key={discipline.id} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(row)}
                    disabled={members.length === 0}
                    onChange={() => toggleDiscipline(discipline.disciplineId)}
                  />
                  <DisciplineDot colorHex={discipline.colorHex} code={discipline.code} />
                  <span className="font-semibold text-[var(--brand-ink)]">{discipline.name}</span>
                </label>
                {members.length === 0 ? (
                  <p className="mt-1 text-xs text-[var(--brand-gray)]">
                    No one&apos;s assigned to {discipline.name} on this project yet — add them in the
                    Team tab first.
                  </p>
                ) : null}

                {row ? (
                  <div className="mt-3 space-y-3 border-l-2 border-[var(--brand-accent)] pl-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Assignee">
                        <Select
                          value={row.assigneeId}
                          onChange={(event) =>
                            patchRow(discipline.disciplineId, { assigneeId: event.target.value })
                          }
                        >
                          <option value="">Choose someone…</option>
                          {members.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.userName}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label="Deadline"
                        error={
                          row.deadline && deadline && row.deadline > deadline
                            ? "Discipline task deadline can't be after the main task's deadline."
                            : undefined
                        }
                      >
                        <DateInput
                          value={row.deadline}
                          max={deadline || undefined}
                          onChange={(event) =>
                            patchRow(discipline.disciplineId, { deadline: event.target.value })
                          }
                        />
                      </Field>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-[var(--brand-text)]">
                      <input
                        type="checkbox"
                        checked={row.isMandatory}
                        onChange={(event) =>
                          patchRow(discipline.disciplineId, { isMandatory: event.target.checked })
                        }
                      />
                      This discipline must finish before the main task can be complete
                    </label>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                        Required documents
                      </p>
                      {row.documents.length === 0 ? (
                        <p className="text-xs text-[var(--brand-gray)]">
                          No required documents — this discipline task can be marked complete
                          without an upload.
                        </p>
                      ) : null}
                      {row.documents.map((document) => (
                        <div key={document.key} className="flex flex-wrap items-center gap-2">
                          <Input
                            aria-label="Required document name"
                            value={document.name}
                            placeholder="e.g. Isometric drawing"
                            className="w-56"
                            onChange={(event) =>
                              patchRow(discipline.disciplineId, {
                                documents: row.documents.map((item) =>
                                  item.key === document.key
                                    ? { ...item, name: event.target.value }
                                    : item,
                                ),
                              })
                            }
                          />
                          <label className="flex items-center gap-1 text-xs text-[var(--brand-text)]">
                            <input
                              type="checkbox"
                              checked={document.isMandatory}
                              onChange={(event) =>
                                patchRow(discipline.disciplineId, {
                                  documents: row.documents.map((item) =>
                                    item.key === document.key
                                      ? { ...item, isMandatory: event.target.checked }
                                      : item,
                                  ),
                                })
                              }
                            />
                            Mandatory
                          </label>
                          <Button
                            variant="ghost"
                            aria-label={`Remove ${document.name || "document"}`}
                            onClick={() =>
                              patchRow(discipline.disciplineId, {
                                documents: row.documents.filter(
                                  (item) => item.key !== document.key,
                                ),
                              })
                            }
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          patchRow(discipline.disciplineId, {
                            documents: [
                              ...row.documents,
                              { key: newKey(), name: "", isMandatory: true },
                            ],
                          })
                        }
                        className="text-sm font-semibold text-[var(--brand-primary)] underline underline-offset-2"
                      >
                        + Add required document
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        <p className="text-xs text-[var(--brand-gray)]">
          Discipline task titles default to &quot;{`<Discipline> — ${title || "main task title"}`}
          &quot; and their deadlines to {deadline ? toDateInputValue(new Date(deadline)) : "the main task's deadline"}.
        </p>
      </div>
    </Modal>
  );
}
