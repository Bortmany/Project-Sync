// A project's Team tab: which disciplines are on the project, and who works on it.
// Admins and project managers get the edit controls; everyone else sees the same content read-only.

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  removeMember,
  removeProjectDiscipline,
  upsertMember,
  upsertProjectDiscipline,
} from "@/components/actions";
import { UserPicker, type PickedUser } from "@/components/people/user-picker";
import { useAction } from "@/components/hooks/use-action";
import { useDisciplines } from "@/components/hooks/use-api";
import {
  Avatar,
  Button,
  Card,
  DisciplineDot,
  ErrorBanner,
  Modal,
  Select,
} from "@/components/ui";
import type { ProjectDTO, RoleName } from "@/lib/zod-schemas";

const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project manager",
  DISCIPLINE_LEAD: "Discipline lead",
  ENGINEER: "Engineer",
};

const PROJECT_ROLES: RoleName[] = ["PROJECT_MANAGER", "DISCIPLINE_LEAD", "ENGINEER"];

export function ProjectTeamTab({
  project,
  canManage,
}: {
  project: ProjectDTO;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { run, pending } = useAction();
  const disciplines = useDisciplines();

  const [addDisciplineOpen, setAddDisciplineOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [newRole, setNewRole] = useState<RoleName>("ENGINEER");
  const [newDiscipline, setNewDiscipline] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
  }

  function membersOf(disciplineId: string) {
    return project.members.filter((member) => member.disciplineId === disciplineId);
  }

  const projectManagers = project.members.filter(
    (member) => member.projectRole === "PROJECT_MANAGER",
  );

  const available = (disciplines.data ?? []).filter(
    (discipline) => !project.disciplines.some((item) => item.disciplineId === discipline.id),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title="Disciplines on this project"
        action={
          canManage ? (
            <Button variant="secondary" onClick={() => setAddDisciplineOpen(true)}>
              + Add discipline
            </Button>
          ) : null
        }
      >
        {project.disciplines.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--olng-text)]">
            No disciplines on this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {project.disciplines.map((discipline) => {
              const people = membersOf(discipline.disciplineId);
              return (
                <li key={discipline.id} className="flex flex-wrap items-center gap-3 py-3">
                  <DisciplineDot colorHex={discipline.colorHex} code={discipline.code} />
                  <span className="min-w-32 flex-1 text-sm font-semibold text-[var(--olng-navy)]">
                    {discipline.name}
                  </span>
                  <span className="text-xs text-[var(--olng-gray)]">
                    {people.length} {people.length === 1 ? "person" : "people"}
                  </span>

                  {canManage ? (
                    <Select
                      aria-label={`Lead for ${discipline.name}`}
                      className="w-48"
                      value={discipline.leadId ?? ""}
                      disabled={pending || people.length === 0}
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
                        {people.length === 0 ? "Add members to this discipline first" : "No lead assigned"}
                      </option>
                      {people.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.userName}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-[var(--olng-text)]">
                      {discipline.leadName ?? "No lead assigned"}
                    </span>
                  )}

                  {canManage ? (
                    <Button
                      variant="ghost"
                      disabled={pending || people.length > 0}
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
                            onSuccess: refresh,
                          },
                        )
                      }
                    >
                      Remove
                    </Button>
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
            <Button variant="secondary" onClick={() => setAddMemberOpen(true)}>
              + Add member
            </Button>
          ) : null
        }
      >
        {project.members.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--olng-text)]">
            No one has been added to this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {project.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={member.userName} size={28} />
                <span className="min-w-32 flex-1">
                  <span className="block text-sm font-semibold text-[var(--olng-navy)]">
                    {member.userName}
                  </span>
                  <span className="block text-xs text-[var(--olng-gray)]">{member.userEmail}</span>
                </span>

                {canManage ? (
                  <>
                    <Select
                      aria-label={`Project role for ${member.userName}`}
                      className="w-44"
                      value={member.projectRole}
                      disabled={pending}
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
                      {PROJECT_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`Discipline for ${member.userName}`}
                      className="w-44"
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
                      onClick={() =>
                        setConfirmRemove({ userId: member.userId, name: member.userName })
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-[var(--olng-text)]">
                      {ROLE_LABEL[member.projectRole]}
                    </span>
                    <span className="text-sm text-[var(--olng-text)]">
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
                  className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-[var(--page-bg)]"
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
        onClose={() => setAddMemberOpen(false)}
        footer={
          <Button
            loading={pending}
            disabled={
              !picked || (newRole !== "PROJECT_MANAGER" && newDiscipline.length === 0)
            }
            onClick={() =>
              run(
                () =>
                  upsertMember({
                    projectId: project.id,
                    userId: picked?.id ?? "",
                    projectRole: newRole,
                    disciplineId: newRole === "PROJECT_MANAGER" ? null : newDiscipline || null,
                  }),
                {
                  success: `${picked?.name ?? "Member"} added to this project.`,
                  failure: "Couldn't add this person. Try again.",
                  onSuccess: () => {
                    refresh();
                    setPicked(null);
                    setNewDiscipline("");
                    setNewRole("ENGINEER");
                    setAddMemberOpen(false);
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
          <UserPicker value={picked} onChange={setPicked} label="Person" />
          <Select
            aria-label="Project role"
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as RoleName)}
          >
            {PROJECT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Discipline"
            value={newDiscipline}
            disabled={newRole === "PROJECT_MANAGER"}
            onChange={(event) => setNewDiscipline(event.target.value)}
          >
            <option value="">Discipline…</option>
            {project.disciplines.map((discipline) => (
              <option key={discipline.id} value={discipline.disciplineId}>
                {discipline.name}
              </option>
            ))}
          </Select>
        </div>
      </Modal>

      <Modal
        open={confirmRemove !== null}
        title="Remove from project"
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
