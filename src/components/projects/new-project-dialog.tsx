// New project — a three-step dialog: details, disciplines, team. Admin and project managers only.

"use client";

import { useEffect, useRef, useState } from "react";
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

/** A contractor's only seat on a project (assertProjectRoleMatchesPerson in projects.ts). */
/**
 * The boxes on step 1. A refusal naming any of them (a code another project in the company already
 * has) sends the person back there, so the error sits under a box they can see and fix.
 */
const STEP_ONE_FIELDS = ["name", "code", "description", "startDate", "targetDate"] as const;

const CONTRACTOR_ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: "EXTERNAL", label: "External contractor" },
];

/** "the empty row", "Salma and the empty row", "Salma, Hamed and the empty rows". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function newKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Why a contractor on the people step cannot join yet. An administrator also gets the Team tab's
 * "Set …'s discipline" shortcut — opened in a new tab, so this half-filled form is not lost.
 */
export function ContractorRowHint({
  problem,
  contractor,
  showSetLink,
}: {
  problem: string;
  contractor: { id: string; name: string };
  showSetLink: boolean;
}) {
  return (
    <div className="space-y-1 sm:col-span-2">
      <p className="text-xs text-[var(--status-blocked)]">{problem}</p>
      {showSetLink ? (
        <a
          href={`/admin/users?edit=${encodeURIComponent(contractor.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)] underline underline-offset-2"
        >
          Set {contractor.name}&apos;s discipline (opens in a new tab — this form stays as it is)
        </a>
      ) : null}
    </div>
  );
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
  const {
    run,
    pending,
    error,
    fieldErrors,
    reset: resetAction,
    clearFieldError,
    clearError,
  } = useAction();
  // Only an administrator can change somebody's account, so only they are offered the shortcut.
  const isAdmin = me?.role === "ADMIN";

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [disciplineIds, setDisciplineIds] = useState<string[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Whether the person has changed the team list yet. Until they have, a missing project manager is
  // a quiet hint rather than a red error — nobody has done anything wrong by opening step 3.
  const [teamEdited, setTeamEdited] = useState(false);

  // Where focus goes once a row's × has taken it off the list: the next row's ×, else the one above,
  // else "+ Add person" — never the page behind the dialog. Held as a row key ("add" for the link)
  // and applied in an effect keyed on that value alone, after the row has really gone.
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addPersonButton = useRef<HTMLButtonElement>(null);
  const [focusAfterRemove, setFocusAfterRemove] = useState<string | null>(null);
  // "+ Add person" puts the cursor straight into the new row's search box, ready to type a name.
  // The row's key, applied in an effect keyed on it alone once the row is on the page.
  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const [focusNewRow, setFocusNewRow] = useState<string | null>(null);

  // Rows the person has moved on from (focus left the row). Until then a row's missing person or
  // discipline is grey help, not a red error — nobody has done anything wrong by pressing
  // "+ Add person" and not having picked anyone yet.
  const [leftRows, setLeftRows] = useState<ReadonlySet<string>>(() => new Set());

  // Moving between steps swaps the footer's buttons and the whole body, so the Next or Back button
  // that had focus is gone. Focus goes to the new step's heading (or, back on step 1, its first box)
  // instead of dropping onto the page. Applied in an effect keyed on this value alone.
  const nameBox = useRef<HTMLInputElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [focusStep, setFocusStep] = useState<number | null>(null);

  useEffect(() => {
    if (focusStep === null) return;
    (focusStep === 1 ? nameBox.current : stepHeading.current)?.focus();
    setFocusStep(null);
  }, [focusStep]);

  function goToStep(next: number) {
    setStep(next);
    setFocusStep(next);
  }

  useEffect(() => {
    if (focusAfterRemove === null) return;
    const target =
      focusAfterRemove === "add"
        ? addPersonButton.current
        : removeButtons.current.get(focusAfterRemove);
    (target ?? addPersonButton.current)?.focus();
    setFocusAfterRemove(null);
  }, [focusAfterRemove]);

  useEffect(() => {
    if (focusNewRow === null) return;
    rowNodes.current.get(focusNewRow)?.querySelector<HTMLInputElement>("input")?.focus();
    setFocusNewRow(null);
  }, [focusNewRow]);

  function addRow() {
    const key = newKey();
    editMembers((current) => [
      ...current,
      { key, user: null, projectRole: "ENGINEER", disciplineId: "" },
    ]);
    setFocusNewRow(key);
  }

  function removeRow(key: string) {
    const index = members.findIndex((item) => item.key === key);
    const neighbour = members[index + 1] ?? members[index - 1];
    editMembers((current) => current.filter((item) => item.key !== key));
    setFocusAfterRemove(neighbour ? neighbour.key : "add");
  }

  function editMembers(change: (current: MemberRow[]) => MemberRow[]) {
    setTeamEdited(true);
    setMembers(change);
  }

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
              user: {
                id: me.id,
                name: me.name,
                email: me.email,
                role: me.role,
                disciplineId: me.disciplineId ?? null,
              },
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
  // What a greyed-out Next on step 1 is waiting for, said beside it: nothing else on the step says
  // the dates are needed, so Next used to stay grey with no reason given.
  const step1Missing = [
    name.trim() ? null : "a name",
    code.trim() ? null : "a code",
    startDate ? null : "a start date",
    targetDate ? null : "a deadline",
  ].filter((item): item is string => item !== null);
  const step2Valid = disciplineIds.length > 0;
  const hasProjectManager = members.some((row) => row.projectRole === "PROJECT_MANAGER" && row.user);
  const step3Valid =
    members.length > 0 &&
    hasProjectManager &&
    members.every(
      (row) =>
        row.user &&
        (row.projectRole === "PROJECT_MANAGER" || row.disciplineId.length > 0) &&
        (row.user.role !== "EXTERNAL" || contractorRowProblem(row.user.disciplineId) === null),
    );

  /**
   * Why this row is holding Create project back, or null. Contractors keep their own fuller note
   * (ContractorRowHint); this covers the empty row and the missing discipline.
   */
  function rowProblem(row: MemberRow): string | null {
    if (!row.user) return "Pick a person for this row, or remove it.";
    if (row.projectRole === "PROJECT_MANAGER" || row.user.role === "EXTERNAL") return null;
    if (row.disciplineId) return null;
    const role = row.projectRole === "DISCIPLINE_LEAD" ? "discipline lead" : "engineer";
    return `Choose a discipline for this ${role}.`;
  }

  // Which rows still need something, named by what the person can see on them: the name picked on
  // the row, or "the empty row" for one with nobody picked yet.
  const unfinished = members.filter(
    (row) =>
      rowProblem(row) !== null ||
      (row.user?.role === "EXTERNAL" && contractorRowProblem(row.user.disciplineId) !== null),
  );
  const emptyCount = unfinished.filter((row) => !row.user).length;
  const unfinishedRows = [
    ...unfinished.flatMap((row) => (row.user ? [row.user.name] : [])),
    ...(emptyCount === 1 ? ["the empty row"] : emptyCount > 1 ? ["the empty rows"] : []),
  ];
  // What Create project's greyed-out state is explained by, for a screen reader: the unfinished
  // rows, the missing project manager, or both.
  const createReasonIds = [
    unfinishedRows.length > 0 ? "new-project-create-reason" : null,
    !hasProjectManager ? "new-project-manager-reason" : null,
  ].filter(Boolean);

  function reset() {
    setStep(1);
    setName("");
    setCode("");
    setDescription("");
    setStartDate("");
    setTargetDate("");
    setDisciplineIds([]);
    setMembers([]);
    setTeamEdited(false);
    setLeftRows(new Set());
    setConfirmDiscard(false);
    resetAction();
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
        // A taken code (or name) is said once, under its box on step 1 — the Create button that was
        // pressed is on step 3, where neither box is shown. Going back to step 1 in the same redraw
        // as the error lets useAction put focus on the box marked invalid.
        shownOnFields: ["name", "code"],
        onRefused: (refused) => {
          if (STEP_ONE_FIELDS.some((key) => (refused[key]?.length ?? 0) > 0)) setStep(1);
        },
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

  /** Why a contractor on this list cannot join yet, or null when they can. Same rule as the Team tab. */
  function contractorRowProblem(contractorDisciplineId: string | null): string | null {
    if (!contractorDisciplineId) {
      return isAdmin
        ? "This contractor has no discipline on their account yet. Set one on their account, then pick them again here."
        : "This contractor has no discipline on their account yet. An administrator sets one before they can join a project.";
    }
    if (!disciplineIds.includes(contractorDisciplineId)) {
      const named = (disciplines.data ?? []).find((item) => item.id === contractorDisciplineId);
      return `Contractors join in their own discipline. Tick ${named?.name ?? "their discipline"} in the previous step to add them.`;
    }
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={`New project — step ${step} of 3`}
      // The dialog opens on step 1 with the cursor in its first box, so typing can start at once.
      initialFocusRef={nameBox}
      footer={
        <>
          {step > 1 ? (
            <Button variant="ghost" onClick={() => goToStep(step - 1)} disabled={pending}>
              Back
            </Button>
          ) : null}
          {step === 1 ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={() => goToStep(2)}
                disabled={!step1Valid}
                aria-describedby={step1Missing.length > 0 ? "new-project-next-reason" : undefined}
              >
                Next
              </Button>
              {step1Missing.length > 0 ? (
                <span id="new-project-next-reason" className="text-xs text-[var(--brand-gray)]">
                  {`Add ${listOf(step1Missing)} to continue.`}
                </span>
              ) : null}
            </div>
          ) : step < 3 ? (
            <Button onClick={() => goToStep(step + 1)} disabled={!step2Valid}>
              Next
            </Button>
          ) : (
            <Button
              onClick={submit}
              loading={pending}
              disabled={!step3Valid}
              aria-describedby={createReasonIds.length > 0 ? createReasonIds.join(" ") : undefined}
            >
              {pending ? "Creating…" : "Create project"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* The server writes its refusals in plain English — a duplicate code, a plan limit — so
            they are shown exactly as they arrive, the way every other dialog in this app does.
            A hardcoded sentence here used to hide what the server actually said. */}
        {error ? <ErrorBanner message={error} /> : null}

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
              <Input
                ref={nameBox}
                value={name}
                onChange={(event) => {
                  clearFieldError("name");
                  setName(event.target.value);
                }}
                required
              />
            </Field>
            <Field
              label="Code"
              hint="Short code used in task lists and tags"
              error={fieldError(fieldErrors, "code")}
            >
              <Input
                value={code}
                placeholder="e.g. LNG-T5"
                onChange={(event) => {
                  // A refusal about the code no longer applies once the code changes: its line
                  // under the box goes, and so does any banner that came with it.
                  if (fieldErrors.code) clearError();
                  clearFieldError("code");
                  setCode(event.target.value.toUpperCase());
                }}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start date">
                <DateInput
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                />
              </Field>
              <Field label="Deadline" error={dateOrderError}>
                <DateInput
                  value={targetDate}
                  min={startDate || undefined}
                  onChange={(event) => setTargetDate(event.target.value)}
                  required
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
            <h3
              ref={stepHeading}
              tabIndex={-1}
              className="text-sm font-semibold text-[var(--brand-ink)] focus:outline-none"
            >
              Which disciplines are involved in this project?
            </h3>
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
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--page-bg)]"
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
            <h3
              ref={stepHeading}
              tabIndex={-1}
              className="text-sm font-semibold text-[var(--brand-ink)] focus:outline-none"
            >
              Add people to this project
            </h3>
            {members.map((row, index) => (
              <div
                key={row.key}
                ref={(node) => {
                  if (node) rowNodes.current.set(row.key, node);
                  else rowNodes.current.delete(row.key);
                }}
                className="grid gap-2 sm:grid-cols-2"
                onBlur={(event) => {
                  // Focus moved somewhere outside this row: the person has moved on from it.
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  if (leftRows.has(row.key)) return;
                  setLeftRows((current) => new Set(current).add(row.key));
                }}
              >
                {/* The person and their remove button share the first line, at every width — on a
                    phone the button used to drop onto a line of its own, far from the person it
                    removes. Role and discipline share the second line, so "External contractor"
                    is never cut off inside a narrow box. */}
                <div className="flex items-center gap-2 sm:col-span-2">
                  <div className="min-w-0 flex-1">
                    <UserPicker
                      value={row.user}
                      label={`Person ${index + 1}`}
                      clearable={false}
                      onChange={(user) =>
                        editMembers((current) =>
                          current.map((item) =>
                            item.key !== row.key
                              ? item
                              : user?.role === "EXTERNAL"
                                ? // A contractor joins as a contractor, in their own discipline, and
                                  // nothing else — the server refuses any other seat for them.
                                  {
                                    ...item,
                                    user,
                                    projectRole: "EXTERNAL",
                                    disciplineId: user.disciplineId ?? "",
                                  }
                                : item.projectRole === "EXTERNAL"
                                  ? {
                                      ...item,
                                      user,
                                      projectRole: "ENGINEER",
                                      disciplineId: "",
                                    }
                                  : { ...item, user },
                          ),
                        )
                      }
                    />
                  </div>
                  {/* The one × on the row: it takes the person (or the empty slot) off the list. */}
                  <Button
                    variant="ghost"
                    aria-label={
                      row.user
                        ? `Remove ${row.user.name} from this project`
                        : "Remove this empty row"
                    }
                    className="shrink-0 px-3"
                    ref={(node) => {
                      if (node) removeButtons.current.set(row.key, node);
                      else removeButtons.current.delete(row.key);
                    }}
                    onClick={() => removeRow(row.key)}
                  >
                    ×
                  </Button>
                </div>
                <Select
                  aria-label="Project role"
                  value={row.projectRole}
                  disabled={row.user?.role === "EXTERNAL"}
                  onChange={(event) =>
                    editMembers((current) =>
                      current.map((item) =>
                        item.key === row.key
                          ? { ...item, projectRole: event.target.value as RoleName }
                          : item,
                      ),
                    )
                  }
                  className="w-full"
                >
                  {(row.user?.role === "EXTERNAL" ? CONTRACTOR_ROLE_OPTIONS : ROLE_OPTIONS).map(
                    (option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ),
                  )}
                </Select>
                <Select
                  aria-label="Discipline"
                  value={row.disciplineId}
                  disabled={row.projectRole === "PROJECT_MANAGER" || row.user?.role === "EXTERNAL"}
                  onChange={(event) =>
                    editMembers((current) =>
                      current.map((item) =>
                        item.key === row.key
                          ? { ...item, disciplineId: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className="w-full"
                >
                  <option value="">Discipline…</option>
                  {chosenDisciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))}
                </Select>
                {rowProblem(row) ? (
                  <p
                    className={`text-xs sm:col-span-2 ${leftRows.has(row.key) ? "text-[var(--status-blocked)]" : "text-[var(--brand-text)]"}`}
                  >
                    {rowProblem(row)}
                  </p>
                ) : null}
                {row.user?.role === "EXTERNAL" && contractorRowProblem(row.user.disciplineId) ? (
                  <ContractorRowHint
                    problem={contractorRowProblem(row.user.disciplineId) ?? ""}
                    contractor={row.user}
                    showSetLink={isAdmin && !row.user.disciplineId}
                  />
                ) : null}
              </div>
            ))}
            {!hasProjectManager ? (
              <p
                id="new-project-manager-reason"
                className={`text-xs ${teamEdited ? "text-[var(--status-blocked)]" : "text-[var(--brand-text)]"}`}
              >
                {members.length === 0
                  ? "Add at least one person — a project needs at least one project manager."
                  : "A project needs at least one project manager."}
              </p>
            ) : null}
            <button
              ref={addPersonButton}
              type="button"
              onClick={addRow}
              className="text-sm font-semibold text-[var(--brand-primary)] underline underline-offset-2"
            >
              + Add person
            </button>
            {/* Beside the footer's greyed-out Create project: which rows are holding it back. */}
            {unfinishedRows.length > 0 ? (
              <p id="new-project-create-reason" className="text-xs text-[var(--brand-text)]">
                {`Finish ${listOf(unfinishedRows)} to create the project.`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
