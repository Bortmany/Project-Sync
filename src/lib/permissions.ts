// Pure permission rules — the single source of truth for who may do what. No database access lives here.

export type RoleValue =
  | "ADMIN"
  | "PROJECT_MANAGER"
  | "DISCIPLINE_LEAD"
  | "ENGINEER"
  | "EXTERNAL";

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
  | "MANAGE_INTEGRATIONS"
  /** Taking a full copy of the company's own data out of Tielora (Admin → Data & privacy). */
  | "EXPORT_ORG"
  /** Asking for the whole workspace to be deleted, and calling that request off again. */
  | "DELETE_ORG"
  /** Seeing the company's plan and its usage, and changing plan (Admin → Billing). */
  | "MANAGE_BILLING"
  | "POST_ANNOUNCEMENT"
  | "POST_BOARD"
  | "VIEW_PROJECT";

/**
 * Who may start a post aimed at the WHOLE company. The company's own setting, mirrored from
 * `BroadcastPolicySchema` in src/lib/zod-schemas.ts the same way `RoleValue` mirrors `RoleSchema` —
 * this file imports nothing, so the rules stay pure and testable on their own.
 */
export type BroadcastPolicyValue = "ADMIN_ONLY" | "ADMIN_PM" | "ADMIN_PM_LEAD";

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
  /**
   * The company's "who may post to Everyone" setting, read from the Organization row by the caller.
   * It is passed IN rather than looked up so `can()` stays pure and touches no database. Absent
   * reads as the default, "administrators and project managers".
   */
  broadcastPolicy?: BroadcastPolicyValue;
} & ({ projectId?: undefined; orgId?: string } | { projectId: string; orgId: string });

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
const ADMIN_ONLY: Action[] = [
  "MANAGE_USERS",
  "MANAGE_DISCIPLINES",
  "MANAGE_INTEGRATIONS",
  "EXPORT_ORG",
  "DELETE_ORG",
  "MANAGE_BILLING",
];

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

/**
 * Everything an EXTERNAL contractor may ever do, and only on a discipline task assigned to them.
 *
 * The same shape as ENGINEER_OWN_TASK_ACTIONS with one deliberate difference: COMMENT is in here,
 * which makes it TIGHTER than it is for a colleague. A member of the company may comment anywhere on
 * a project they belong to; a contractor may only comment on their own work.
 */
const EXTERNAL_OWN_TASK_ACTIONS: Action[] = [
  "UPDATE_DISCIPLINE_TASK_STATUS",
  "COMPLETE_DISCIPLINE_TASK",
  "UPLOAD_DOCUMENT",
  "COMMENT",
];

/** Starting a post (an announcement or a board post) aimed at one audience. */
const POST_ACTIONS: Action[] = ["POST_ANNOUNCEMENT", "POST_BOARD"];

function membershipFor(actor: Actor, projectId?: string): Membership | undefined {
  if (!projectId) return undefined;
  return actor.memberships.find((membership) => membership.projectId === projectId);
}

/**
 * The role that applies inside a project is the PROJECT role — per-project assignment
 * always wins, in both directions: a global manager added to someone else's project as
 * an engineer acts as an engineer there. Admins bypass this entirely in can().
 *
 * EXTERNAL is the one role that never escalates. A contractor is a contractor on every project,
 * whatever a ProjectMember row says — the services also refuse to write any other project role for
 * one, so the two agree, but this function does not depend on that being true.
 */
function effectiveRole(actor: Actor, membership: Membership | undefined): RoleValue {
  if (actor.role === "EXTERNAL") return "EXTERNAL";
  if (!membership) return actor.role;
  return membership.projectRole;
}

/**
 * A contractor from another company: their own assigned work and nothing else.
 *
 * VIEW_PROJECT here means "may look at the project at all", and it is only half the answer — the
 * read side narrows it again in `assertCanViewProject`, which requires at least one live discipline
 * task in that project actually assigned to them, and every listing they touch is filtered to those
 * tasks. Nothing that manages, creates, edits, deletes or overrides is reachable from here.
 */
function canExternal(actor: Actor, action: Action, ctx: PermissionContext): boolean {
  const membership = membershipFor(actor, ctx.projectId);
  if (!ctx.projectId || !membership) return false;
  if (action === "VIEW_PROJECT") return true;
  if (EXTERNAL_OWN_TASK_ACTIONS.includes(action)) {
    return Boolean(ctx.assigneeId) && ctx.assigneeId === actor.userId;
  }
  return false;
}

/**
 * May this person start a post aimed at this audience?
 *
 * Three audiences, three rules — and an audience is exactly one of them, so a context naming both a
 * project and a discipline is refused rather than guessed at:
 *
 * - **The whole company** (no project, no discipline): the company's own `broadcastPolicy` decides.
 *   Administrators always; project managers under ADMIN_PM or ADMIN_PM_LEAD; discipline leads only
 *   under ADMIN_PM_LEAD. Nobody else, ever.
 * - **One project**: its project managers. Belonging to the project is what makes somebody a manager
 *   of it, so a manager elsewhere is refused here, exactly as every other project action works.
 * - **One discipline**: its leads, read from their memberships — a person leads a discipline on a
 *   project, and that is the only place the app records it.
 *
 * Reading is not gated here at all. Everybody in the company reads the company-wide board, and the
 * service narrows project and discipline boards to the audiences a person belongs to.
 */
function canPostToAudience(actor: Actor, ctx: PermissionContext): boolean {
  const disciplineId = ctx.disciplineId ?? null;

  if (!ctx.projectId && !disciplineId) {
    const policy: BroadcastPolicyValue = ctx.broadcastPolicy ?? "ADMIN_PM";
    if (actor.role === "PROJECT_MANAGER") return policy === "ADMIN_PM" || policy === "ADMIN_PM_LEAD";
    if (actor.role === "DISCIPLINE_LEAD") return policy === "ADMIN_PM_LEAD";
    return false;
  }

  if (ctx.projectId) {
    // One post, one audience. A project post is for the project, never "the project AND a discipline".
    if (disciplineId) return false;
    const membership = membershipFor(actor, ctx.projectId);
    if (!membership) return false;
    return effectiveRole(actor, membership) === "PROJECT_MANAGER";
  }

  return actor.memberships.some(
    (membership) =>
      membership.projectRole === "DISCIPLINE_LEAD" && membership.disciplineId === disciplineId,
  );
}

/** Answers "may this person do this?" — the only place that question is answered. */
export function can(actor: Actor, action: Action, ctx: PermissionContext = {}): boolean {
  // The organisation boundary comes first and applies to everybody, administrators included: being
  // an ADMIN makes you the administrator of your OWN company, never of anyone else's.
  if (ctx.orgId && ctx.orgId !== actor.orgId) return false;

  // A contractor is answered here and never falls through to the rules below — no project role, no
  // membership and no admin flag can widen what an EXTERNAL may do.
  if (actor.role === "EXTERNAL") return canExternal(actor, action, ctx);

  if (actor.role === "ADMIN") {
    // An administrator may post to any audience in their OWN company — the organisation check above
    // is what keeps "any" inside it. A post still has exactly one audience.
    if (POST_ACTIONS.includes(action)) return !(ctx.projectId && ctx.disciplineId);
    return true;
  }
  if (ADMIN_ONLY.includes(action)) return false;

  // A post is judged by its audience, not by a project membership, so it is answered before the
  // membership gate below: a company-wide post names no project at all.
  if (POST_ACTIONS.includes(action)) return canPostToAudience(actor, ctx);

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
      "MANAGE_INTEGRATIONS",
      "EXPORT_ORG",
      "DELETE_ORG",
      "MANAGE_BILLING",
      "POST_ANNOUNCEMENT",
      "POST_BOARD",
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
      // Their own projects always; the whole company only while the broadcast setting allows it.
      "POST_ANNOUNCEMENT",
      "POST_BOARD",
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
      // Their own discipline always; the whole company only under the widest broadcast setting.
      "POST_ANNOUNCEMENT",
      "POST_BOARD",
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
  // A contractor: everything is conditional, and every condition is "this task is assigned to me".
  EXTERNAL: {
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
