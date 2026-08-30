// Pure permission rules — the single source of truth for who may do what. No database access lives here.

export type RoleValue = "ADMIN" | "PROJECT_MANAGER" | "DISCIPLINE_LEAD" | "ENGINEER";

export type Membership = {
  projectId: string;
  projectRole: RoleValue;
  disciplineId?: string | null;
};

export type Actor = {
  userId: string;
  /** The organisation this person belongs to. Nobody ever acts outside it. */
  orgId: string;
  role: RoleValue;
  memberships: Membership[];
};

export type Action =
  | "CREATE_PROJECT"
  | "EDIT_PROJECT"
  | "DELETE_PROJECT"
  | "MANAGE_MEMBERS"
  | "MANAGE_PROJECT_DISCIPLINES"
  | "CREATE_MAIN_TASK"
  | "EDIT_MAIN_TASK"
  | "DELETE_MAIN_TASK"
  | "OVERRIDE_MAIN_TASK_STATUS"
  | "CREATE_DISCIPLINE_TASK"
  | "EDIT_DISCIPLINE_TASK"
  | "ASSIGN_DISCIPLINE_TASK"
  | "UPDATE_DISCIPLINE_TASK_STATUS"
  | "COMPLETE_DISCIPLINE_TASK"
  | "UPLOAD_DOCUMENT"
  | "DELETE_DOCUMENT"
  | "COMMENT"
  | "MANAGE_USERS"
  | "MANAGE_DISCIPLINES"
  | "VIEW_PROJECT";

/**
 * What is being acted on.
 *
 * `orgId` is the organisation the TARGET belongs to, read from the row itself — never assumed to be
 * the actor's. The type makes it impossible to name a project without it: a check that mentions a
 * `projectId` must also say whose project it is, and `can()` refuses the moment the two disagree.
 */
export type PermissionContext = {
  disciplineId?: string | null;
  assigneeId?: string | null;
} & ({ projectId?: undefined; orgId?: undefined } | { projectId: string; orgId: string });

export class ForbiddenError extends Error {
  readonly action: Action;
  readonly code = "FORBIDDEN" as const;

  constructor(action: Action, message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
    this.action = action;
  }
}

/** Actions only an administrator ever performs. */
const ADMIN_ONLY: Action[] = ["MANAGE_USERS", "MANAGE_DISCIPLINES"];

/** Actions a discipline lead may perform inside their own discipline on a project they belong to. */
const LEAD_DISCIPLINE_ACTIONS: Action[] = [
  "ASSIGN_DISCIPLINE_TASK",
  "UPDATE_DISCIPLINE_TASK_STATUS",
  "COMPLETE_DISCIPLINE_TASK",
];

/** Actions any project member may perform. */
const MEMBER_ACTIONS: Action[] = ["VIEW_PROJECT", "COMMENT"];

/** Actions an engineer may perform on a discipline task assigned to them. */
const ENGINEER_OWN_TASK_ACTIONS: Action[] = [
  "UPDATE_DISCIPLINE_TASK_STATUS",
  "COMPLETE_DISCIPLINE_TASK",
  "UPLOAD_DOCUMENT",
];

function membershipFor(actor: Actor, projectId?: string): Membership | undefined {
  if (!projectId) return undefined;
  return actor.memberships.find((membership) => membership.projectId === projectId);
}

/**
 * The role that applies inside a project is the PROJECT role — per-project assignment
 * always wins, in both directions: a global manager added to someone else's project as
 * an engineer acts as an engineer there. Admins bypass this entirely in can().
 */
function effectiveRole(actor: Actor, membership: Membership | undefined): RoleValue {
  if (!membership) return actor.role;
  return membership.projectRole;
}

/** Answers "may this person do this?" — the only place that question is answered. */
export function can(actor: Actor, action: Action, ctx: PermissionContext = {}): boolean {
  // The organisation boundary comes first and applies to everybody, administrators included: being
  // an ADMIN makes you the administrator of your OWN company, never of anyone else's.
  if (ctx.orgId && ctx.orgId !== actor.orgId) return false;

  if (actor.role === "ADMIN") return true;
  if (ADMIN_ONLY.includes(action)) return false;

  // Creating a project needs no project context — project managers may start one.
  if (action === "CREATE_PROJECT") return actor.role === "PROJECT_MANAGER";

  const membership = membershipFor(actor, ctx.projectId);
  if (!ctx.projectId || !membership) return false;

  const role = effectiveRole(actor, membership);

  // A project manager runs everything inside their own projects.
  if (role === "PROJECT_MANAGER") return true;

  if (MEMBER_ACTIONS.includes(action)) return true;

  if (role === "DISCIPLINE_LEAD") {
    if (action === "UPLOAD_DOCUMENT") return true;
    if (LEAD_DISCIPLINE_ACTIONS.includes(action)) {
      return Boolean(
        ctx.disciplineId && membership.disciplineId && ctx.disciplineId === membership.disciplineId,
      );
    }
    return false;
  }

  // Engineer: only their own assigned work.
  if (ENGINEER_OWN_TASK_ACTIONS.includes(action)) {
    return Boolean(ctx.assigneeId) && ctx.assigneeId === actor.userId;
  }
  return false;
}

/** Same question, but throws the app's typed error when the answer is no. */
export function assertCan(actor: Actor, action: Action, ctx: PermissionContext = {}): void {
  if (!can(actor, action, ctx)) throw new ForbiddenError(action);
}

/**
 * A coarse map for hiding buttons in the UI. Server-side `can`/`assertCan` is still the
 * decision that matters — this only avoids showing controls that would fail.
 */
export const PERMISSION_MATRIX: Record<RoleValue, { always: Action[]; conditional: Action[] }> = {
  ADMIN: {
    always: [
      "CREATE_PROJECT",
      "EDIT_PROJECT",
      "DELETE_PROJECT",
      "MANAGE_MEMBERS",
      "MANAGE_PROJECT_DISCIPLINES",
      "CREATE_MAIN_TASK",
      "EDIT_MAIN_TASK",
      "DELETE_MAIN_TASK",
      "OVERRIDE_MAIN_TASK_STATUS",
      "CREATE_DISCIPLINE_TASK",
      "EDIT_DISCIPLINE_TASK",
      "ASSIGN_DISCIPLINE_TASK",
      "UPDATE_DISCIPLINE_TASK_STATUS",
      "COMPLETE_DISCIPLINE_TASK",
      "UPLOAD_DOCUMENT",
      "DELETE_DOCUMENT",
      "COMMENT",
      "MANAGE_USERS",
      "MANAGE_DISCIPLINES",
      "VIEW_PROJECT",
    ],
    conditional: [],
  },
  PROJECT_MANAGER: {
    always: ["CREATE_PROJECT"],
    conditional: [
      "EDIT_PROJECT",
      "DELETE_PROJECT",
      "MANAGE_MEMBERS",
      "MANAGE_PROJECT_DISCIPLINES",
      "CREATE_MAIN_TASK",
      "EDIT_MAIN_TASK",
      "DELETE_MAIN_TASK",
      "OVERRIDE_MAIN_TASK_STATUS",
      "CREATE_DISCIPLINE_TASK",
      "EDIT_DISCIPLINE_TASK",
      "ASSIGN_DISCIPLINE_TASK",
      "UPDATE_DISCIPLINE_TASK_STATUS",
      "COMPLETE_DISCIPLINE_TASK",
      "UPLOAD_DOCUMENT",
      "DELETE_DOCUMENT",
      "COMMENT",
      "VIEW_PROJECT",
    ],
  },
  DISCIPLINE_LEAD: {
    always: [],
    conditional: [
      "VIEW_PROJECT",
      "COMMENT",
      "UPLOAD_DOCUMENT",
      "ASSIGN_DISCIPLINE_TASK",
      "UPDATE_DISCIPLINE_TASK_STATUS",
      "COMPLETE_DISCIPLINE_TASK",
    ],
  },
  ENGINEER: {
    always: [],
    conditional: [
      "VIEW_PROJECT",
      "COMMENT",
      "UPDATE_DISCIPLINE_TASK_STATUS",
      "COMPLETE_DISCIPLINE_TASK",
      "UPLOAD_DOCUMENT",
    ],
  },
};
