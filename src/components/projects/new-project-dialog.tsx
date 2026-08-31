// New project — a three-step dialog: details, disciplines, team. Admin and project managers only.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createProject } from "@/components/actions";
import { UserPicker, type PickedUser } from "@/components/people/user-picker";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { useDisciplines, type MeDTO } from "@/components/hooks/use-api";
import {
  Button,
  DateInput,
  DisciplineDot,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import type { RoleName } from "@/lib/zod-schemas";

type MemberRow = { key: string; user: PickedUser | null; projectRole: RoleName; disciplineId: string };

const ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: "PROJECT_MANAGER", label: "Project manager" },
  { value: "DISCIPLINE_LEAD", label: "Discipline lead" },
  { value: "ENGINEER", label: "Engineer" },
];

function newKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function NewProjectDialog({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose: () => void;
  me: MeDTO | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const disciplines = useDisciplines();
  const { run, pending, error, fieldErrors } = useAction();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [disciplineIds, setDisciplineIds] = useState<string[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty =
    name !== "" || code !== "" || description !== "" || startDate !== "" || targetDate !== "";

  // The person creating the project starts on it as a project manager.
  useEffect(() => {
    if (!open || !me) return;
    setMembers((current) =>
      current.length > 0
        ? current
        : [
            {
              key: newKey(),
              user: { id: me.id, name: me.name, email: me.email },
              projectRole: "PROJECT_MANAGER",
              disciplineId: "",
            },
          ],
    );
  }, [open, me]);

  const dateOrderError =
    startDate && targetDate && targetDate < startDate
      ? "Deadline can't be before the start date."
      : undefined;

  const step1Valid = Boolean(name.trim() && code.trim() && startDate && targetDate) && !dateOrderError;
  const step2Valid = disciplineIds.length > 0;
  const hasProjectManager = members.some((row) => row.projectRole === "PROJECT_MANAGER" && row.user);
  const step3Valid =
    members.length > 0 &&
    hasProjectManager &&
    members.every(
      (row) =>
        row.user && (row.projectRole === "PROJECT_MANAGER" || row.disciplineId.length > 0),
    );

  function reset() {
    setStep(1);
    setName("");
    setCode("");
    setDescription("");
    setStartDate("");
    setTargetDate("");
    setDisciplineIds([]);
    setMembers([]);
    setConfirmDiscard(false);
  }

  function requestClose() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    reset();
    onClose();
  }

  function submit() {
    run(
      () =>
        createProject({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          description: description.trim(),
          startDate: startDate ? new Date(startDate) : null,
          targetDate: targetDate ? new Date(targetDate) : null,
          disciplineIds,
          members: members
            .filter((row) => row.user)
            .map((row) => ({
              userId: row.user?.id ?? "",
              projectRole: row.projectRole,
              disciplineId: row.disciplineId || null,
            })),
        }),
      {
        success: `Project ${code.trim().toUpperCase()} created.`,
        failure: "Couldn't create the project. Try again.",
        onSuccess: (project) => {
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          reset();
          onClose();
          router.push(`/projects/${project.id}`);
        },
      },
    );
  }

  const chosenDisciplines = (disciplines.data ?? []).filter((item) =>
    disciplineIds.includes(item.id),
  );

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={`New project — step ${step} of 3`}
      footer={
        <>
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={pending}>
              Back
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !step1Valid : !step2Valid}
            >
              Next
            </Button>
          ) : (
            <Button onClick={submit} loading={pending} disabled={!step3Valid}>
              {pending ? "Creating…" : "Create project"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error ? <ErrorBanner message="Couldn't create the project. Try again." /> : null}

        {confirmDiscard ? (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] p-3">
            <p className="mb-2 text-sm">Discard this new project? Your changes won&apos;t be saved.</p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Discard
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <Field label="Name" error={fieldError(fieldErrors, "name")}>
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field
              label="Code"
              hint="Short code used in task lists and tags"
              error={fieldError(fieldErrors, "code")}
            >
              <Input
                value={code}
                placeholder="e.g. LNG-T5"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start date">
                <DateInput
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field label="Deadline" error={dateOrderError}>
                <DateInput
                  value={targetDate}
                  min={startDate || undefined}
                  onChange={(event) => setTargetDate(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                value={description}
                placeholder="What's this project about?"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[var(--brand-ink)]">
              Which disciplines are involved in this project?
            </p>
            {disciplines.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : disciplines.isError ? (
              <ErrorBanner
                message="Couldn't load disciplines. Try refreshing the page."
                onRetry={() => void disciplines.refetch()}
              />
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {(disciplines.data ?? []).map((discipline) => (
                  <label
                    key={discipline.id}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--page-bg)]"
                  >
                    <input
                      type="checkbox"
                      checked={disciplineIds.includes(discipline.id)}
                      onChange={() =>
                        setDisciplineIds((current) =>
                          current.includes(discipline.id)
                            ? current.filter((id) => id !== discipline.id)
                            : [...current, discipline.id],
                        )
                      }
                    />
                    <DisciplineDot colorHex={discipline.colorHex} code={discipline.code} />
                    <span className="text-[var(--brand-ink)]">{discipline.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[var(--brand-ink)]">
              Add people to this project
            </p>
            {members.map((row, index) => (
              <div key={row.key} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <UserPicker
                  value={row.user}
                  label={`Person ${index + 1}`}
                  onChange={(user) =>
                    setMembers((current) =>
                      current.map((item) => (item.key === row.key ? { ...item, user } : item)),
                    )
                  }
                />
                <Select
                  aria-label="Project role"
                  value={row.projectRole}
                  onChange={(event) =>
                    setMembers((current) =>
                      current.map((item) =>
                        item.key === row.key
                          ? { ...item, projectRole: event.target.value as RoleName }
                          : item,
                      ),
                    )
                  }
                  className="w-44"
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Discipline"
                  value={row.disciplineId}
                  disabled={row.projectRole === "PROJECT_MANAGER"}
                  onChange={(event) =>
                    setMembers((current) =>
                      current.map((item) =>
                        item.key === row.key
                          ? { ...item, disciplineId: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className="w-44"
                >
                  <option value="">Discipline…</option>
                  {chosenDisciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  aria-label="Remove person"
                  onClick={() =>
                    setMembers((current) => current.filter((item) => item.key !== row.key))
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            {!hasProjectManager ? (
              <p className="text-xs text-[var(--status-blocked)]">
                A project needs at least one project manager.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() =>
                setMembers((current) => [
                  ...current,
                  { key: newKey(), user: null, projectRole: "ENGINEER", disciplineId: "" },
                ])
              }
              className="text-sm font-semibold text-[var(--brand-primary)] underline underline-offset-2"
            >
              + Add person
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
