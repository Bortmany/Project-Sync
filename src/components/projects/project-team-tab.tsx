// A project's Team tab: which disciplines are on the project, and who works on it.
// Admins and project managers get the edit controls; everyone else sees the same content read-only.

"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  addMember,
  removeMember,
  removeProjectDiscipline,
  upsertMember,
  upsertProjectDiscipline,
} from "@/components/actions";
import { UserPicker, type PickedUser } from "@/components/people/user-picker";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { useDisciplines, useMe } from "@/components/hooks/use-api";
import {
  Avatar,
  Button,
  Card,
  DisciplineDot,
  ErrorBanner,
  Modal,
  Select,
  focusWhenReady,
  neighbourOf,
  type FocusAfterClose,
} from "@/components/ui";
import type { ProjectDTO, RoleName } from "@/lib/zod-schemas";

const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project manager",
  DISCIPLINE_LEAD: "Discipline lead",
  ENGINEER: "Engineer",
  EXTERNAL: "External contractor",
};

const PROJECT_ROLES: RoleName[] = ["PROJECT_MANAGER", "DISCIPLINE_LEAD", "ENGINEER"];
// A contractor's only seat, and nobody else's: the server refuses every other pairing
// (assertProjectRoleMatchesPerson in src/server/services/projects.ts), so the form never offers one.
const CONTRACTOR_ROLES: RoleName[] = ["EXTERNAL"];

/** The project roles this person may hold, decided by who they are rather than by the form. */
function rolesFor(role: RoleName | undefined): RoleName[] {
  return role === "EXTERNAL" ? CONTRACTOR_ROLES : PROJECT_ROLES;
}

export function ProjectTeamTab({
  project,
  canManage,
}: {
  project: ProjectDTO;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { run, pending, fieldErrors, clearFieldError } = useAction();
  const disciplines = useDisciplines();
  const me = useMe();
  // Only an administrator can change somebody's account, so only they are offered the shortcut.
  const isAdmin = me.data?.role === "ADMIN";

  const [addDisciplineOpen, setAddDisciplineOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [newRole, setNewRole] = useState<RoleName>("ENGINEER");
  const [newDiscipline, setNewDiscipline] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  // The two lists' "+ Add …" buttons, where focus goes when a list has nothing left to land on.
  const addDisciplineButton = useRef<HTMLButtonElement>(null);
  const addMemberButton = useRef<HTMLButtonElement>(null);
  const membersList = useRef<HTMLUListElement>(null);
  // "Add a member" opens with the cursor in its Person search, ready to type a name.
  const personSearch = useRef<HTMLInputElement>(null);
  // Set when a member is removed: their row (and its Remove button, the dialog's opener) goes, so
  // once the dialog has closed focus moves to the next member's Remove, else the one above, else
  // "+ Add member".
  const afterRemove = useRef<FocusAfterClose | null>(null);

  // A cancelled "Add a member" forgets who was picked: opening it again starts empty.
  function closeAddMember() {
    clearFieldError("userId");
    setPicked(null);
    setNewDiscipline("");
    setNewRole("ENGINEER");
    setAddMemberOpen(false);
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
  }

  function membersOf(disciplineId: string) {
    return project.members.filter((member) => member.disciplineId === disciplineId);
  }

  // A discipline lead signs off contractors' work and sees the whole discipline, so a contractor is
  // never offered as one — the server refuses it too (upsertProjectDiscipline). One already set
  // before that rule stays listed, so the box still says who it is until somebody changes it.
  function possibleLeads(disciplineId: string, currentLeadId: string | null) {
    return membersOf(disciplineId).filter(
      (member) => member.projectRole !== "EXTERNAL" || member.userId === currentLeadId,
    );
  }

  // Somebody already on the project is changed from the Members list, never through "Add a member":
  // the search still finds them, marked "Already on this project", but they cannot be picked (and
  // addMember refuses them if they were).
  const alreadyOnProject = useMemo(
    () => new Map(project.members.map((member) => [member.userId, "Already on this project"])),
    [project.members],
  );
  const addMemberRefusal = fieldError(fieldErrors, "userId");

  const projectManagers = project.members.filter(
    (member) => member.projectRole === "PROJECT_MANAGER",
  );

  const available = (disciplines.data ?? []).filter(
    (discipline) => !project.disciplines.some((item) => item.disciplineId === discipline.id),
  );

  // Who the picked person is decides the rest of the form. A contractor joins as a contractor, in
  // the discipline on their account — the server accepts nothing else, so nothing else is offered.
  const pickedIsContractor = picked?.role === "EXTERNAL";
  const pickedRole: RoleName = pickedIsContractor ? "EXTERNAL" : newRole;
  const contractorDiscipline = pickedIsContractor
    ? (disciplines.data ?? []).find((discipline) => discipline.id === picked?.disciplineId)
    : undefined;
  const contractorDisciplineOnProject =
    contractorDiscipline !== undefined &&
    project.disciplines.some((row) => row.disciplineId === contractorDiscipline.id);
  // A contractor joins in their own discipline, so one saved before contractors needed a discipline
  // cannot join until their account has one. An administrator gets a link straight to the fix.
  const contractorLacksDiscipline = pickedIsContractor && !contractorDiscipline;
  const contractorProblem = !pickedIsContractor
    ? null
    : !contractorDiscipline
      ? isAdmin
        ? "This contractor has no discipline on their account yet. Set one on their account, then add them here."
        : "This contractor has no discipline on their account yet. An administrator sets one before they can join a project."
      : !contractorDisciplineOnProject
        ? `${contractorDiscipline.name} isn't on this project yet. Add the discipline first, then add this contractor.`
        : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title="Disciplines on this project"
        action={
          canManage ? (
            <Button
              ref={addDisciplineButton}
              variant="secondary"
              onClick={() => setAddDisciplineOpen(true)}
            >
              + Add discipline
            </Button>
          ) : null
        }
      >
        {project.disciplines.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--brand-text)]">
            No disciplines on this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {project.disciplines.map((discipline) => {
              const people = membersOf(discipline.disciplineId);
              const leads = possibleLeads(discipline.disciplineId, discipline.leadId);
              return (
                <li key={discipline.id} className="flex flex-wrap items-center gap-3 py-3">
                  <DisciplineDot colorHex={discipline.colorHex} code={discipline.code} />
                  <span className="min-w-32 flex-1 text-sm font-semibold text-[var(--brand-ink)]">
                    {discipline.name}
                  </span>
                  <span className="text-xs text-[var(--brand-gray)]">
                    {people.length} {people.length === 1 ? "person" : "people"}
                  </span>

                  {canManage ? (
                    <Select
                      aria-label={`Lead for ${discipline.name}`}
                      className="w-48"
                      value={discipline.leadId ?? ""}
                      disabled={pending || leads.length === 0}
                      onChange={(event) =>
                        run(
                          () =>
                            upsertProjectDiscipline({
                              projectId: project.id,
                              disciplineId: discipline.disciplineId,
                              leadId: event.target.value || null,
                            }),
                          {
                            success: "Discipline lead updated.",
                            failure: "Couldn't update the discipline lead. Try again.",
                            onSuccess: refresh,
                          },
                        )
                      }
                    >
                      <option value="">
                        {leads.length === 0 ? "Add members to this discipline first" : "No lead assigned"}
                      </option>
                      {leads.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.userName}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-[var(--brand-text)]">
                      {discipline.leadName ?? "No lead assigned"}
                    </span>
                  )}

                  {canManage ? (
                    <Button
                      variant="ghost"
                      disabled={pending || people.length > 0}
                      // Every row has a Remove, so each says which discipline it takes off — and a
                      // greyed-out one says why it can't yet, out loud as well as on hover.
                      aria-label={`Remove ${discipline.name}`}
                      aria-describedby={
                        people.length > 0 ? `remove-discipline-why-${discipline.id}` : undefined
                      }
                      title={
                        people.length > 0
                          ? "Remove members from this discipline first"
                          : `Remove ${discipline.name}`
                      }
                      onClick={() =>
                        run(
                          () =>
                            removeProjectDiscipline({
                              projectId: project.id,
                              disciplineId: discipline.disciplineId,
                            }),
                          {
                            success: `${discipline.name} removed from this project.`,
                            failure: "Couldn't remove that discipline. Try again.",
                            onSuccess: () => {
                              refresh();
                              // The row and its button go; "+ Add discipline" heads the list.
                              focusWhenReady(() => addDisciplineButton.current);
                            },
                          },
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                  {canManage && people.length > 0 ? (
                    <span id={`remove-discipline-why-${discipline.id}`} className="sr-only">
                      {`${discipline.name} still has ${people.length === 1 ? "a member" : `${people.length} members`} on this project. Move or remove ${people.length === 1 ? "them" : "them all"} first.`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Members"
        action={
          canManage ? (
            <Button ref={addMemberButton} variant="secondary" onClick={() => setAddMemberOpen(true)}>
              + Add member
            </Button>
          ) : null
        }
      >
        {project.members.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--brand-text)]">
            No one has been added to this project yet.
          </p>
        ) : (
          <ul ref={membersList} className="divide-y divide-[var(--border)]">
            {project.members.map((member) => (
              <li
                key={member.id}
                data-member-id={member.userId}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <Avatar name={member.userName} size={28} />
                <span className="min-w-32 flex-1">
                  <span className="block text-sm font-semibold text-[var(--brand-ink)]">
                    {member.userName}
                  </span>
                  <span className="block text-xs text-[var(--brand-gray)]">{member.userEmail}</span>
                </span>

                {canManage ? (
                  <>
                    <Select
                      aria-label={`Project role for ${member.userName}`}
                      className="w-full min-w-44 sm:w-56"
                      value={member.projectRole}
                      // A contractor's seat cannot be changed into a colleague's, here or anywhere.
                      disabled={pending || member.projectRole === "EXTERNAL"}
                      onChange={(event) =>
                        run(
                          () =>
                            upsertMember({
                              projectId: project.id,
                              userId: member.userId,
                              projectRole: event.target.value as RoleName,
                              disciplineId: member.disciplineId,
                            }),
                          {
                            success: "Project role updated.",
                            failure: "Couldn't update this member. Try again.",
                            onSuccess: refresh,
                          },
                        )
                      }
                    >
                      {rolesFor(member.projectRole).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`Discipline for ${member.userName}`}
                      className="w-full min-w-44 sm:w-56"
                      value={member.disciplineId ?? ""}
                      disabled={pending || member.projectRole === "PROJECT_MANAGER"}
                      onChange={(event) =>
                        run(
                          () =>
                            upsertMember({
                              projectId: project.id,
                              userId: member.userId,
                              projectRole: member.projectRole,
                              disciplineId: event.target.value || null,
                            }),
                          {
                            success: "Discipline updated.",
                            failure: "Couldn't update this member. Try again.",
                            onSuccess: refresh,
                          },
                        )
                      }
                    >
                      <option value="">—</option>
                      {project.disciplines.map((discipline) => (
                        <option key={discipline.id} value={discipline.disciplineId}>
                          {discipline.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Remove ${member.userName}`}
                      onClick={() =>
                        setConfirmRemove({ userId: member.userId, name: member.userName })
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-[var(--brand-text)]">
                      {ROLE_LABEL[member.projectRole]}
                    </span>
                    <span className="text-sm text-[var(--brand-text)]">
                      {member.disciplineCode ?? "—"}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={addDisciplineOpen}
        title="Add a discipline"
        onClose={() => setAddDisciplineOpen(false)}
      >
        {disciplines.isError ? (
          <ErrorBanner
            message="Couldn't load disciplines. Try refreshing the page."
            onRetry={() => void disciplines.refetch()}
          />
        ) : available.length === 0 ? (
          <p>Every discipline is already on this project.</p>
        ) : (
          <ul className="space-y-1">
            {available.map((discipline) => (
              <li key={discipline.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        upsertProjectDiscipline({
                          projectId: project.id,
                          disciplineId: discipline.id,
                          leadId: null,
                        }),
                      {
                        success: `${discipline.name} added to this project.`,
                        failure: "Couldn't add that discipline. Try again.",
                        onSuccess: () => {
                          refresh();
                          setAddDisciplineOpen(false);
                        },
                      },
                    )
                  }
                  className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-[var(--page-bg)]"
                >
                  <DisciplineDot colorHex={discipline.colorHex} code={discipline.code} />
                  {discipline.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={addMemberOpen}
        title="Add a member"
        onClose={closeAddMember}
        initialFocusRef={personSearch}
        footer={
          <Button
            loading={pending}
            disabled={
              !picked ||
              contractorProblem !== null ||
              (pickedRole !== "PROJECT_MANAGER" && newDiscipline.length === 0)
            }
            onClick={() =>
              run(
                () =>
                  addMember({
                    projectId: project.id,
                    userId: picked?.id ?? "",
                    projectRole: pickedRole,
                    disciplineId: pickedRole === "PROJECT_MANAGER" ? null : newDiscipline || null,
                  }),
                {
                  success: `${picked?.name ?? "Member"} added to this project.`,
                  failure: "Couldn't add this person. Try again.",
                  // "Already on this project" is said once, under the Person box.
                  shownOnFields: ["userId"],
                  onSuccess: () => {
                    refresh();
                    closeAddMember();
                  },
                },
              )
            }
          >
            Add to project
          </Button>
        }
      >
        <div className="space-y-3">
          <UserPicker
            value={picked}
            label="Person"
            searchRef={personSearch}
            unavailable={alreadyOnProject}
            onChange={(user) => {
              clearFieldError("userId");
              setPicked(user);
              // Picking a contractor sets both fields for them; picking a colleague clears them.
              setNewRole(user?.role === "EXTERNAL" ? "EXTERNAL" : "ENGINEER");
              setNewDiscipline(user?.role === "EXTERNAL" ? (user.disciplineId ?? "") : "");
            }}
          />
          {addMemberRefusal ? (
            <p role="alert" className="text-xs text-[var(--status-blocked)]">
              {addMemberRefusal}
            </p>
          ) : null}
          <Select
            aria-label="Project role"
            value={pickedRole}
            disabled={pickedIsContractor}
            onChange={(event) => setNewRole(event.target.value as RoleName)}
          >
            {rolesFor(picked?.role).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Discipline"
            value={newDiscipline}
            disabled={pickedIsContractor || pickedRole === "PROJECT_MANAGER"}
            onChange={(event) => setNewDiscipline(event.target.value)}
          >
            <option value="">Discipline…</option>
            {contractorDiscipline && !contractorDisciplineOnProject ? (
              <option value={contractorDiscipline.id}>{contractorDiscipline.name}</option>
            ) : null}
            {project.disciplines.map((discipline) => (
              <option key={discipline.id} value={discipline.disciplineId}>
                {discipline.name}
              </option>
            ))}
          </Select>

          {pickedIsContractor ? (
            <p className="text-xs text-[var(--brand-text)]">
              {picked?.name} works for another company. Contractors join as external contractors, in
              their own discipline, and only see the tasks assigned to them.
            </p>
          ) : null}
          {contractorProblem ? (
            <p className="text-xs text-[var(--status-blocked)]">{contractorProblem}</p>
          ) : null}
          {contractorLacksDiscipline && isAdmin && picked ? (
            <Link
              href={`/admin/users?edit=${encodeURIComponent(picked.id)}`}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)] underline underline-offset-2"
            >
              Set {picked.name}&apos;s discipline
            </Link>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={confirmRemove !== null}
        title="Remove from project"
        focusAfterCloseRef={afterRemove}
        onClose={() => setConfirmRemove(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={
                projectManagers.length <= 1 &&
                projectManagers.some((member) => member.userId === confirmRemove?.userId)
              }
              onClick={() =>
                run(
                  () =>
                    removeMember({ projectId: project.id, userId: confirmRemove?.userId ?? "" }),
                  {
                    success: `${confirmRemove?.name ?? "Member"} removed from this project.`,
                    failure: "Couldn't remove this person. Try again.",
                    onSuccess: () => {
                      const list = membersList.current;
                      const row = Array.from(list?.querySelectorAll("[data-member-id]") ?? []).find(
                        (element) => element.getAttribute("data-member-id") === confirmRemove?.userId,
                      );
                      afterRemove.current = () =>
                        (list && neighbourOf(row, 'button[aria-label^="Remove "]', list)) ??
                        addMemberButton.current;
                      refresh();
                      setConfirmRemove(null);
                    },
                  },
                )
              }
            >
              Remove
            </Button>
          </>
        }
      >
        <p>
          Remove {confirmRemove?.name} from this project? They&apos;ll lose access to its tasks and
          documents.
        </p>
        {projectManagers.length <= 1 &&
        projectManagers.some((member) => member.userId === confirmRemove?.userId) ? (
          <p className="mt-2 text-xs text-[var(--status-blocked)]">
            Assign another project manager before removing this one.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
