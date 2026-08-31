// Admin → Users: the whole directory, deactivated people included, and the only way an account
// is ever created. A new password is shown once, here, and never anywhere else.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createUser, deactivateUser, resendInvite, updateUser } from "@/components/actions";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { formatDate, formatDateUtc, toUtcDateInputValue } from "@/components/format";
import {
  Avatar,
  Badge,
  Button,
  CompanyBadge,
  DateInput,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  Field,
  FilterChips,
  Input,
  Modal,
  Select,
  hasActiveFilters,
  type ActiveFilters,
  type FilterDimension,
} from "@/components/ui";
import { isAccessExpired } from "@/lib/access-expiry";
import type { CreateUserModeName, DisciplineDTO, RoleName, UserDTO } from "@/lib/zod-schemas";

const ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "PROJECT_MANAGER", label: "Project manager" },
  { value: "DISCIPLINE_LEAD", label: "Discipline lead" },
  { value: "ENGINEER", label: "Engineer" },
  { value: "EXTERNAL", label: "External contractor" },
];

const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project manager",
  DISCIPLINE_LEAD: "Discipline lead",
  ENGINEER: "Engineer",
  EXTERNAL: "External",
};

/** The roles whose work always sits inside one discipline. */
const DISCIPLINE_ROLES: RoleName[] = ["DISCIPLINE_LEAD", "ENGINEER"];

/** The one hint the access-end field carries, in both dialogs. */
const ACCESS_ENDS_HINT =
  "Optional. After this date they're locked out automatically — leave it blank for no expiry.";

/** A date typed into the form, ready for the server: blank means "no expiry". */
function accessEndsValue(role: RoleName, typed: string): Date | null {
  return role === "EXTERNAL" && typed ? new Date(typed) : null;
}

const PASSWORD_LENGTH = 16;
// No look-alike characters — this password gets read out or typed by hand.
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** A strong one-off password, made in the browser and shown to the admin once. */
function generatePassword(): string {
  const values = new Uint32Array(PASSWORD_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]).join("");
}

function PasswordPanel({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] p-3">
      <code className="block break-all font-mono text-sm text-[var(--brand-ink)]">{password}</code>
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(password).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy password"}
      </Button>
      <p className="text-xs text-[var(--brand-gray)]">
        This is the only time it is shown. If it is lost, set a new one from Edit.
      </p>
    </div>
  );
}

function NewUserDialog({
  disciplines,
  inviteAvailable,
  open,
  onClose,
}: {
  disciplines: DisciplineDTO[];
  /** True only when this deployment can actually send email. False renders today's dialog exactly. */
  inviteAvailable: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { run, pending, error, fieldErrors } = useAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleName>("ENGINEER");
  const [companyName, setCompanyName] = useState("");
  const [accessEnds, setAccessEnds] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [password, setPassword] = useState(generatePassword);
  // "Set a password" is the default: it is today's behaviour, and the safer answer before anybody
  // has chosen. With email dormant it is the only path, and the choice is never shown.
  const [mode, setMode] = useState<CreateUserModeName>("PASSWORD");
  const [created, setCreated] = useState<UserDTO | null>(null);
  const [createdMode, setCreatedMode] = useState<CreateUserModeName>("PASSWORD");

  const needsDiscipline = DISCIPLINE_ROLES.includes(role);
  const needsCompany = role === "EXTERNAL";
  const inviting = inviteAvailable && mode === "INVITE";

  function close() {
    setCreated(null);
    setName("");
    setEmail("");
    setRole("ENGINEER");
    setAccessEnds("");
    setDisciplineId("");
    setJobTitle("");
    setPassword(generatePassword());
    setMode("PASSWORD");
    onClose();
  }

  if (created) {
    // Two different endings. The invitation branch has no password panel at all, because there is
    // no password to share — that is the whole point of inviting somebody.
    return createdMode === "INVITE" ? (
      <Modal
        open={open}
        title="Invite sent"
        size="sm"
        onClose={close}
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="space-y-3">
          <p>
            Invite sent to{" "}
            <span className="font-semibold text-[var(--brand-ink)]">{created.email}</span>.
            They&apos;ll get an email with a link to set their own password. It expires in 7 days —
            if it lapses, open Edit and resend it.
          </p>
        </div>
      </Modal>
    ) : (
      <Modal
        open={open}
        title="User created"
        size="sm"
        onClose={close}
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="space-y-3">
          <p>Share these sign-in details with {created.name}:</p>
          <p className="text-sm font-semibold text-[var(--brand-ink)]">{created.email}</p>
          <PasswordPanel password={password} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="New user"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={
              !name.trim() ||
              !email.trim() ||
              (needsDiscipline && !disciplineId) ||
              (needsCompany && !companyName.trim())
            }
            onClick={() =>
              run(
                () =>
                  createUser({
                    name: name.trim(),
                    email: email.trim(),
                    // An invitation sends no password at all — there is none to send.
                    ...(inviting ? {} : { password }),
                    mode: inviting ? "INVITE" : "PASSWORD",
                    role,
                    disciplineId: disciplineId || null,
                    jobTitle: jobTitle.trim() || null,
                    companyName: companyName.trim() || null,
                    accessExpiresAt: accessEndsValue(role, accessEnds),
                  }),
                {
                  success: inviting ? "Invite sent." : "User created.",
                  failure: inviting
                    ? "Couldn't send this invite. Try again."
                    : "Couldn't create this user. Try again.",
                  onSuccess: (user) => {
                    setCreatedMode(inviting ? "INVITE" : "PASSWORD");
                    setCreated(user);
                    router.refresh();
                  },
                },
              )
            }
          >
            {inviting ? "Send invite" : "Create user"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        {inviteAvailable ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant={mode === "PASSWORD" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => setMode("PASSWORD")}
            >
              Set a password
            </Button>
            <Button
              variant={mode === "INVITE" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => setMode("INVITE")}
            >
              Email them an invite link
            </Button>
          </div>
        ) : null}
        <Field label="Name" error={fieldError(fieldErrors, "name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Email" error={fieldError(fieldErrors, "email")}>
          <Input
            type="email"
            value={email}
            placeholder="name@company.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role">
            <Select value={role} onChange={(event) => setRole(event.target.value as RoleName)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Discipline"
            hint={needsDiscipline ? "Required for leads and engineers." : "Not needed for this role."}
            error={fieldError(fieldErrors, "disciplineId")}
          >
            <Select
              value={disciplineId}
              onChange={(event) => setDisciplineId(event.target.value)}
            >
              <option value="">No discipline</option>
              {disciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {needsCompany ? (
          <Field
            label="Company"
            hint="Shown beside their name everywhere, so everyone knows whose engineer they are."
            error={fieldError(fieldErrors, "companyName")}
          >
            <Input
              value={companyName}
              placeholder="e.g. Al Hassan Engineering"
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </Field>
        ) : null}
        {needsCompany ? (
          <Field
            label="Access ends"
            hint={ACCESS_ENDS_HINT}
            error={fieldError(fieldErrors, "accessExpiresAt")}
          >
            <DateInput value={accessEnds} onChange={(event) => setAccessEnds(event.target.value)} />
          </Field>
        ) : null}
        <Field label="Job title" hint="Optional — how the role reads on their profile.">
          <Input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
        </Field>
        {inviting ? null : (
          <Field
            label="First password"
            hint="Generated for you. Share it once, in person or by phone."
          >
            <div className="flex items-center gap-2">
              <Input value={password} readOnly className="font-mono" />
              <Button variant="secondary" onClick={() => setPassword(generatePassword())}>
                New one
              </Button>
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

/**
 * "Resend invite email" — only for somebody who has never signed in, and only when this deployment
 * can send email at all. Somebody who has already chosen a password does not need a fresh
 * invitation; "New password" in the same dialog is what their administrator wants instead.
 */
function ResendInviteButton({ user }: { user: UserDTO }) {
  const { run, pending } = useAction();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        run(() => resendInvite({ id: user.id }), {
          success: "Invite email sent again.",
          failure: "Couldn't send that invite. Try again.",
        })
      }
      className="text-xs font-semibold text-[var(--brand-primary)] hover:underline disabled:text-[var(--brand-gray)]"
    >
      {pending ? "Sending…" : "Resend invite email"}
    </button>
  );
}

function EditUserDialog({
  user,
  disciplines,
  inviteAvailable,
  onClose,
}: {
  user: UserDTO;
  disciplines: DisciplineDTO[];
  inviteAvailable: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { run, pending, error, fieldErrors } = useAction();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<RoleName>(user.role);
  const [companyName, setCompanyName] = useState(user.companyName ?? "");
  // The UTC reading, not the local one: the date is stored at UTC midnight and goes back out as
  // `new Date("YYYY-MM-DD")`, so reading it locally west of Greenwich would move the day back one
  // on every save until the contractor was locked out early.
  const [accessEnds, setAccessEnds] = useState(toUtcDateInputValue(user.accessExpiresAt));
  const [disciplineId, setDisciplineId] = useState(user.disciplineId ?? "");
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? "");
  const [password, setPassword] = useState("");

  const needsDiscipline = DISCIPLINE_ROLES.includes(role);
  const needsCompany = role === "EXTERNAL";

  return (
    <Modal
      open
      title={`Edit ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={
              !name.trim() || (needsDiscipline && !disciplineId) || (needsCompany && !companyName.trim())
            }
            onClick={() =>
              run(
                () =>
                  updateUser({
                    id: user.id,
                    name: name.trim(),
                    role,
                    disciplineId: disciplineId || null,
                    jobTitle: jobTitle.trim() || null,
                    companyName: companyName.trim() || null,
                    accessExpiresAt: accessEndsValue(role, accessEnds),
                    ...(password ? { password } : {}),
                  }),
                {
                  success: "Changes saved.",
                  failure: "Couldn't save these changes. Try again.",
                  onSuccess: () => {
                    router.refresh();
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
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Name" error={fieldError(fieldErrors, "name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Email" hint="Email addresses can't be changed here.">
          <Input value={user.email} disabled readOnly />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role">
            <Select value={role} onChange={(event) => setRole(event.target.value as RoleName)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Discipline"
            hint={needsDiscipline ? "Required for leads and engineers." : "Not needed for this role."}
            error={fieldError(fieldErrors, "disciplineId")}
          >
            <Select value={disciplineId} onChange={(event) => setDisciplineId(event.target.value)}>
              <option value="">No discipline</option>
              {disciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {needsCompany ? (
          <Field
            label="Company"
            hint="Shown beside their name everywhere, so everyone knows whose engineer they are."
            error={fieldError(fieldErrors, "companyName")}
          >
            <Input
              value={companyName}
              placeholder="e.g. Al Hassan Engineering"
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </Field>
        ) : null}
        {needsCompany ? (
          <Field
            label="Access ends"
            hint={ACCESS_ENDS_HINT}
            error={fieldError(fieldErrors, "accessExpiresAt")}
          >
            <DateInput value={accessEnds} onChange={(event) => setAccessEnds(event.target.value)} />
          </Field>
        ) : null}
        <Field label="Job title">
          <Input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
        </Field>
        <Field
          label="New password"
          hint="Leave empty to keep the current one."
          error={fieldError(fieldErrors, "password")}
        >
          <div className="flex items-center gap-2">
            <Input
              value={password}
              readOnly
              placeholder="Not changing"
              className="font-mono"
            />
            <Button variant="secondary" onClick={() => setPassword(generatePassword())}>
              Generate
            </Button>
          </div>
        </Field>
        {password ? <PasswordPanel password={password} /> : null}
        {inviteAvailable && user.isActive && !user.lastLoginAt ? (
          <div className="space-y-1 border-t border-[var(--border)] pt-3">
            <ResendInviteButton user={user} />
            <p className="text-xs text-[var(--brand-gray)]">
              {user.name} hasn&apos;t signed in yet. Sending it again replaces the link already in
              their inbox.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function DeactivateDialog({ user, onClose }: { user: UserDTO; onClose: () => void }) {
  const router = useRouter();
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      size="sm"
      title="Deactivate user"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() =>
              run(() => deactivateUser({ id: user.id }), {
                success: `${user.name} can no longer sign in.`,
                failure: "Couldn't deactivate this user. Try again.",
                onSuccess: () => {
                  router.refresh();
                  onClose();
                },
              })
            }
          >
            Deactivate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        <p>
          Deactivate {user.name}? They won&apos;t be able to sign in, but their history stays on
          record.
        </p>
      </div>
    </Modal>
  );
}

function ReactivateButton({ user }: { user: UserDTO }) {
  const router = useRouter();
  const { run, pending } = useAction();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        run(() => updateUser({ id: user.id, isActive: true }), {
          success: `${user.name} can sign in again.`,
          failure: "Couldn't reactivate this user. Try again.",
          onSuccess: () => router.refresh(),
        })
      }
      className="text-xs font-semibold text-[var(--brand-primary)] hover:underline disabled:text-[var(--brand-gray)]"
    >
      Reactivate
    </button>
  );
}

export function AdminUsersView({
  users,
  disciplines,
  inviteAvailable = false,
}: {
  users: UserDTO[];
  disciplines: DisciplineDTO[];
  /** Whether this deployment can send email. False means the screen looks exactly as it always has. */
  inviteAvailable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [deactivating, setDeactivating] = useState<UserDTO | null>(null);
  const [filters, setFilters] = useState<ActiveFilters>({ role: [], discipline: [], status: [] });

  const disciplineName = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );

  const dimensions: FilterDimension[] = [
    { key: "role", label: "Role", options: ROLE_OPTIONS },
    {
      key: "discipline",
      label: "Discipline",
      options: disciplines.map((discipline) => ({ value: discipline.id, label: discipline.name })),
    },
    {
      key: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "deactivated", label: "Deactivated" },
      ],
    },
  ];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((user) => {
      const roles = filters.role ?? [];
      const disciplineIds = filters.discipline ?? [];
      const statuses = filters.status ?? [];
      if (needle && !`${user.name} ${user.email}`.toLowerCase().includes(needle)) return false;
      if (roles.length > 0 && !roles.includes(user.role)) return false;
      if (disciplineIds.length > 0 && !disciplineIds.includes(user.disciplineId ?? "")) return false;
      if (statuses.length > 0 && !statuses.includes(user.isActive ? "active" : "deactivated")) {
        return false;
      }
      return true;
    });
  }, [users, search, filters]);

  function clearFilters() {
    setSearch("");
    setFilters({ role: [], discipline: [], status: [] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Users</h1>
        <Button onClick={() => setNewOpen(true)}>+ New user</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search users by name or email…"
          aria-label="Search users"
          className="max-w-xs"
        />
        <FilterChips filters={dimensions} active={filters} onChange={setFilters} />
      </div>

      {users.length === 0 ? (
        <EmptyState message="No people yet. Create the first account to get the team started." />
      ) : visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--brand-text)]">
          <p>No users match your search.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-1 font-semibold text-[var(--brand-primary)] underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--brand-gray)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Discipline</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Access ends</th>
                <th className="px-3 py-2 font-semibold">Last signed in</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visible.map((user) => {
                const discipline = user.disciplineId
                  ? disciplineName.get(user.disciplineId)
                  : undefined;
                const isContractor = user.role === "EXTERNAL";
                // Expired is worked out here, from the date — it is never stored.
                const expired = isAccessExpired(user);
                return (
                  <tr
                    key={user.id}
                    className={`h-11 hover:bg-[var(--page-bg)] ${user.isActive ? "" : "opacity-60"}`}
                  >
                    <td className="px-3">
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-[var(--brand-ink)]">
                        <Avatar name={user.name} size={24} />
                        {user.name}
                        <CompanyBadge companyName={user.companyName} />
                      </span>
                    </td>
                    <td className="px-3 text-[var(--brand-text)]">{user.email}</td>
                    <td className="px-3 text-[var(--brand-text)]">{ROLE_LABEL[user.role]}</td>
                    <td className="px-3">
                      {discipline ? (
                        <DisciplineDot
                          colorHex={discipline.colorHex}
                          code={discipline.name}
                          showCode
                        />
                      ) : (
                        <span className="text-[var(--brand-gray)]">—</span>
                      )}
                    </td>
                    <td className="px-3 text-[var(--brand-text)]">
                      {isContractor && user.companyName ? (
                        user.companyName
                      ) : (
                        <span className="text-[var(--brand-gray)]">—</span>
                      )}
                    </td>
                    <td className="px-3">
                      {!isContractor ? (
                        <span className="text-[var(--brand-gray)]">—</span>
                      ) : !user.accessExpiresAt ? (
                        <span className="text-[var(--brand-gray)]">No expiry</span>
                      ) : expired ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[var(--status-blocked)]">
                            {formatDateUtc(user.accessExpiresAt)}
                          </span>
                          <Badge color="var(--status-blocked)">Expired</Badge>
                          <button
                            type="button"
                            onClick={() => setEditing(user)}
                            className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
                          >
                            Extend
                          </button>
                        </span>
                      ) : (
                        <span className="text-[var(--brand-text)]">
                          {formatDateUtc(user.accessExpiresAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 text-[var(--brand-text)]">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                    </td>
                    <td className="px-3">
                      {user.isActive ? (
                        <Badge color="var(--status-completed)">Active</Badge>
                      ) : (
                        <Badge color="var(--brand-gray)">Deactivated</Badge>
                      )}
                    </td>
                    <td className="px-3">
                      <span className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setEditing(user)}
                          className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
                        >
                          Edit
                        </button>
                        {user.isActive ? (
                          <button
                            type="button"
                            onClick={() => setDeactivating(user)}
                            className="text-xs font-semibold text-[var(--status-blocked)] hover:underline"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <ReactivateButton user={user} />
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasActiveFilters(filters) && visible.length > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="text-xs font-semibold text-[var(--brand-primary)] underline underline-offset-2"
        >
          Clear filters
        </button>
      ) : null}

      <NewUserDialog
        disciplines={disciplines}
        inviteAvailable={inviteAvailable}
        open={newOpen}
        onClose={() => setNewOpen(false)}
      />
      {editing ? (
        <EditUserDialog
          user={editing}
          disciplines={disciplines}
          inviteAvailable={inviteAvailable}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {deactivating ? (
        <DeactivateDialog user={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
    </div>
  );
}
