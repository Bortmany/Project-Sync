// THE CONTRACT FILE: every input and every DTO the app uses. Later milestones import these names — never redefine them.

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const RoleSchema = z.enum([
  "ADMIN",
  "PROJECT_MANAGER",
  "DISCIPLINE_LEAD",
  "ENGINEER",
  /** A contractor from another company: their own assigned discipline tasks and nothing else. */
  "EXTERNAL",
]);
export type RoleName = z.infer<typeof RoleSchema>;

/** What a noticeboard post is. A string column in the database, validated here. */
export const PostKindSchema = z.enum(["ANNOUNCEMENT", "BOARD"]);
export type PostKindName = z.infer<typeof PostKindSchema>;

/**
 * Who may post to the whole company. A string column in the database, validated here — so a fourth
 * policy later needs no migration, exactly like `OrgIntegration.kind`.
 *
 * Reading company-wide posts is never gated; this only decides who may START one.
 */
export const BroadcastPolicySchema = z.enum(["ADMIN_ONLY", "ADMIN_PM", "ADMIN_PM_LEAD"]);
export type BroadcastPolicyName = z.infer<typeof BroadcastPolicySchema>;

/** What a company gets before anybody changes it — the column's own default. */
export const DEFAULT_BROADCAST_POLICY: BroadcastPolicyName = "ADMIN_PM";

/**
 * Reads the stored policy defensively, the same way `dailyBrief` carries a default: a value this
 * build does not recognise reads as the default rather than breaking every screen that shows it.
 * "ADMIN" is the one legacy spelling of "administrators only" and is mapped, not dropped.
 */
export function broadcastPolicyOf(value: unknown): BroadcastPolicyName {
  if (value === "ADMIN") return "ADMIN_ONLY";
  const parsed = BroadcastPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_BROADCAST_POLICY;
}

/**
 * Which plan a company is on. A string column in the database, validated here — the same choice
 * `broadcastPolicy`, `OrgIntegration.kind` and `Post.kind` made, so a third plan needs no migration.
 *
 * The NUMBERS behind each plan are deliberately not here: they live in one file,
 * `src/lib/plan-limits.ts`, with the helper that reads an unrecognised stored value as FREE.
 */
export const PlanSchema = z.enum(["FREE", "PRO"]);
export type PlanName = z.infer<typeof PlanSchema>;

export const TaskStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "AWAITING_REVIEW",
  "COMPLETED",
]);
export type TaskStatusName = z.infer<typeof TaskStatusSchema>;

export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type PriorityName = z.infer<typeof PrioritySchema>;

export const ProjectStatusSchema = z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]);
export type ProjectStatusName = z.infer<typeof ProjectStatusSchema>;

export const NotificationTypeSchema = z.enum([
  "ASSIGNED",
  "MENTIONED",
  "STATUS_CHANGED",
  "DEADLINE_APPROACHING",
  "OVERDUE",
  "DOCUMENT_UPLOADED",
  "COMMENT_ADDED",
  "OVERRIDE_APPLIED",
  "ANNOUNCEMENT",
]);
export type NotificationTypeName = z.infer<typeof NotificationTypeSchema>;

const id = z.string().min(1).max(40);
const dateIn = z.coerce.date();
const dateOut = z.coerce.date();
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().max(10_000);

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

/**
 * The one password rule in the app: at least 12 characters, at most 200. Signing a company up,
 * accepting an invitation and resetting a forgotten password all parse through this, so the
 * threshold and the wording can never drift apart between the screens that ask for one.
 */
export const PasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters — a short sentence works well.")
  .max(200);

/** An email address as every form in the app accepts one. */
const emailAddress = z.string().trim().toLowerCase().email().max(200);

/** The discipline sets a brand-new company can start from. The lists live in src/server/industry-templates.ts. */
export const IndustryTemplateSchema = z.enum(["OIL_AND_GAS", "CONSTRUCTION", "GENERIC"]);
export type IndustryTemplateName = z.infer<typeof IndustryTemplateSchema>;

/**
 * Signing a new company up: the company itself and the person who will run it, in one form.
 * The password rule is the same 12-character minimum an administrator's "create user" form uses.
 */
export const SignupInput = z.object({
  organizationName: z.string().trim().min(2, "Tell us your company's name.").max(120),
  industryTemplate: IndustryTemplateSchema,
  name: z.string().trim().min(1, "Tell us your name.").max(200),
  email: z.string().trim().toLowerCase().email("Use an email address like name@company.com.").max(200),
  password: PasswordSchema,
});
export type SignupInput = z.infer<typeof SignupInput>;

/** What signup hands back once the company, its disciplines and its first administrator exist. */
export const SignupResultDTO = z.object({
  id: id,
  name: z.string(),
  role: RoleSchema,
  organizationId: id,
  organizationName: z.string(),
  organizationSlug: z.string(),
});
export type SignupResultDTO = z.infer<typeof SignupResultDTO>;

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const UserDTO = z.object({
  id: id,
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
  disciplineId: z.string().nullable(),
  disciplineCode: z.string().nullable().optional(),
  jobTitle: z.string().nullable(),
  /** The company an EXTERNAL contractor works for. Null for a colleague. */
  companyName: z.string().nullable().optional(),
  isActive: z.boolean(),
  // Only the admin user screens need sign-in history; the pickers must not carry it.
  lastLoginAt: dateOut.nullable().optional(),
  /**
   * When an EXTERNAL contractor's access ends; null means it never does. Admin screens only, like
   * lastLoginAt — the pickers and mentionable lists must not carry it. "Expired" is derived from
   * it at read time (`isAccessExpired()` in src/lib/access-expiry.ts), never stored.
   */
  accessExpiresAt: dateOut.nullable().optional(),
  /**
   * Whether this person finished switching two-factor sign-in on. Admin screens only, like
   * lastLoginAt — the pickers and mentionable lists must not carry it, and nothing about the secret
   * or the recovery codes is ever in a DTO.
   */
  twoFactorEnabled: z.boolean().optional(),
  createdAt: dateOut,
});
export type UserDTO = z.infer<typeof UserDTO>;

/** The refusal both user forms give when an access-end date is sent for somebody who is not a contractor. */
const ACCESS_EXPIRY_EXTERNAL_ONLY = "Only an external contractor can have an access end date.";

/**
 * How a new colleague gets their first password.
 *
 * `PASSWORD` is the original behaviour and stays the default: the administrator is handed a
 * generated one to pass on, and it is the ONLY path while transactional email is dormant.
 * `INVITE` creates the account with no usable password at all and emails them a single-use link to
 * set their own — so nobody but them ever knows it.
 */
export const CreateUserModeSchema = z.enum(["PASSWORD", "INVITE"]);
export type CreateUserModeName = z.infer<typeof CreateUserModeSchema>;

/** What the create-user form says when it sends neither a password nor an invitation. */
const PASSWORD_OR_INVITE = "Set a first password, or email them an invite link.";

export const CreateUserInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    name: shortText,
    /** Required on the `PASSWORD` path, and refused as pointless on the `INVITE` one. */
    password: z.string().min(12).max(200).optional(),
    /**
     * Left out means `PASSWORD` — exactly what every caller written before invitations meant, and
     * why this is optional rather than defaulted: an omitted mode stays omitted all the way to the
     * service, which reads anything but `"INVITE"` as the original behaviour.
     */
    mode: CreateUserModeSchema.optional(),
    role: RoleSchema,
    disciplineId: id.nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    /** Required for an EXTERNAL contractor — the service refuses one without it. */
    companyName: z.string().trim().max(120).nullable().optional(),
    /** Optional, and only for an EXTERNAL contractor — after it, they are locked out. */
    accessExpiresAt: dateIn.nullable().optional(),
  })
  .refine((value) => !value.accessExpiresAt || value.role === "EXTERNAL", {
    message: ACCESS_EXPIRY_EXTERNAL_ONLY,
    path: ["accessExpiresAt"],
  })
  .refine((value) => value.mode === "INVITE" || typeof value.password === "string", {
    message: PASSWORD_OR_INVITE,
    path: ["password"],
  })
  // An invitation carries no password anywhere: not in the form, not in the request, not in the
  // audit row. Refusing one that was sent anyway keeps that promise honest.
  .refine((value) => value.mode !== "INVITE" || value.password === undefined, {
    message: "An invited person chooses their own password.",
    path: ["password"],
  });
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const UpdateUserInput = z
  .object({
    id: id,
    name: shortText.optional(),
    role: RoleSchema.optional(),
    disciplineId: id.nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    companyName: z.string().trim().max(120).nullable().optional(),
    /**
     * Only for an EXTERNAL contractor. A role sent alongside it must be EXTERNAL; when no role is
     * sent, the service checks the one already on the account and clears the date for anybody else.
     */
    accessExpiresAt: dateIn.nullable().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(12).max(200).optional(),
  })
  .refine((value) => !value.accessExpiresAt || value.role === undefined || value.role === "EXTERNAL", {
    message: ACCESS_EXPIRY_EXTERNAL_ONLY,
    path: ["accessExpiresAt"],
  });
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

/* ------------------------------------------------------------------ */
/* Disciplines                                                         */
/* ------------------------------------------------------------------ */

export const DisciplineDTO = z.object({
  id: id,
  code: z.string(),
  name: z.string(),
  colorHex: z.string(),
  sortOrder: z.number().int(),
});
export type DisciplineDTO = z.infer<typeof DisciplineDTO>;

export const CreateDisciplineInput = z.object({
  code: z.string().trim().min(2).max(12).toUpperCase(),
  name: shortText,
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #00558C."),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type CreateDisciplineInput = z.infer<typeof CreateDisciplineInput>;

export const UpdateDisciplineInput = z.object({
  id: id,
  name: shortText.optional(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type UpdateDisciplineInput = z.infer<typeof UpdateDisciplineInput>;

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export const ProjectMemberDTO = z.object({
  id: id,
  projectId: id,
  userId: id,
  userName: z.string(),
  userEmail: z.string(),
  /** The contractor's own company, when this member is an EXTERNAL. */
  companyName: z.string().nullable().optional(),
  projectRole: RoleSchema,
  disciplineId: z.string().nullable(),
  disciplineCode: z.string().nullable(),
});
export type ProjectMemberDTO = z.infer<typeof ProjectMemberDTO>;

export const ProjectDisciplineDTO = z.object({
  id: id,
  projectId: id,
  disciplineId: id,
  code: z.string(),
  name: z.string(),
  colorHex: z.string(),
  leadId: z.string().nullable(),
  leadName: z.string().nullable(),
});
export type ProjectDisciplineDTO = z.infer<typeof ProjectDisciplineDTO>;

export const ProjectDTO = z.object({
  id: id,
  name: z.string(),
  code: z.string(),
  description: z.string(),
  status: ProjectStatusSchema,
  startDate: dateOut.nullable(),
  targetDate: dateOut.nullable(),
  createdById: id,
  createdByName: z.string(),
  createdAt: dateOut,
  /** Work a contractor finishes waits for an internal sign-off while this is true. */
  externalSignoffRequired: z.boolean(),
  disciplines: z.array(ProjectDisciplineDTO),
  members: z.array(ProjectMemberDTO),
  counts: z.object({
    mainTasks: z.number().int(),
    completed: z.number().int(),
    overdue: z.number().int(),
  }),
  progressPct: z.number().int(),
});
export type ProjectDTO = z.infer<typeof ProjectDTO>;

export const ProjectListItemDTO = z.object({
  id: id,
  name: z.string(),
  code: z.string(),
  status: ProjectStatusSchema,
  targetDate: dateOut.nullable(),
  progressPct: z.number().int(),
  mainTaskCount: z.number().int(),
  overdueCount: z.number().int(),
  disciplines: z.array(z.object({ id: id, code: z.string(), colorHex: z.string() })),
});
export type ProjectListItemDTO = z.infer<typeof ProjectListItemDTO>;

export const CreateProjectInput = z.object({
  name: shortText,
  code: z.string().trim().min(2).max(20).toUpperCase(),
  description: longText,
  startDate: dateIn.nullable().optional(),
  targetDate: dateIn.nullable().optional(),
  disciplineIds: z.array(id).max(50).default([]),
  members: z
    .array(
      z.object({
        userId: id,
        projectRole: RoleSchema,
        disciplineId: id.nullable().optional(),
      }),
    )
    .max(200)
    .default([]),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z.object({
  id: id,
  name: shortText.optional(),
  description: longText.optional(),
  status: ProjectStatusSchema.optional(),
  startDate: dateIn.nullable().optional(),
  targetDate: dateIn.nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

/** The project setting that decides whether a contractor's finished work waits for a sign-off. */
export const SetExternalSignoffInput = z.object({
  projectId: id,
  required: z.boolean(),
});
export type SetExternalSignoffInput = z.infer<typeof SetExternalSignoffInput>;

/** Confirming or sending back work a contractor submitted for review. */
export const ConfirmReviewInput = z.object({ id: id });
export type ConfirmReviewInput = z.infer<typeof ConfirmReviewInput>;

export const RejectReviewInput = z.object({
  id: id,
  note: z.string().trim().min(5, "Say what needs changing (at least 5 characters).").max(500),
});
export type RejectReviewInput = z.infer<typeof RejectReviewInput>;

export const UpsertMemberInput = z.object({
  projectId: id,
  userId: id,
  projectRole: RoleSchema,
  disciplineId: id.nullable().optional(),
});
export type UpsertMemberInput = z.infer<typeof UpsertMemberInput>;

export const UpsertProjectDisciplineInput = z.object({
  projectId: id,
  disciplineId: id,
  leadId: id.nullable().optional(),
});
export type UpsertProjectDisciplineInput = z.infer<typeof UpsertProjectDisciplineInput>;

/* ------------------------------------------------------------------ */
/* Phases (the stage gates)                                            */
/* ------------------------------------------------------------------ */

/**
 * One stage gate on a project. `locked` and `lockedByPhaseName` are DERIVED at read time from the
 * phases before this one (src/lib/phase-lock.ts) — neither is ever stored, in the same way OVERDUE
 * is never stored on a task.
 */
export const PhaseDTO = z.object({
  id: id,
  projectId: id,
  name: z.string(),
  sortOrder: z.number().int(),
  locked: z.boolean(),
  /** The phase this one is waiting for, or null when nothing is holding it. */
  lockedByPhaseName: z.string().nullable(),
  overridden: z.boolean(),
  overrideReason: z.string().nullable(),
  overriddenByName: z.string().nullable(),
  overriddenAt: dateOut.nullable(),
  taskCount: z.number().int(),
  completedCount: z.number().int(),
});
export type PhaseDTO = z.infer<typeof PhaseDTO>;

export const CreatePhaseInput = z.object({
  projectId: id,
  name: z.string().trim().min(1, "Give the phase a name.").max(60),
});
export type CreatePhaseInput = z.infer<typeof CreatePhaseInput>;

export const RenamePhaseInput = z.object({
  id: id,
  name: z.string().trim().min(1, "Give the phase a name.").max(60),
});
export type RenamePhaseInput = z.infer<typeof RenamePhaseInput>;

/** The full ordered list of the project's phase ids — nothing may be left out or invented. */
export const ReorderPhasesInput = z.object({
  projectId: id,
  phaseIds: z.array(id).min(1).max(50),
});
export type ReorderPhasesInput = z.infer<typeof ReorderPhasesInput>;

export const DeletePhaseInput = z.object({ id: id });
export type DeletePhaseInput = z.infer<typeof DeletePhaseInput>;

/** The recorded, authorised way past a stage gate. Same rule as a main-task status override. */
export const OverridePhaseLockInput = z.object({
  id: id,
  reason: z.string().trim().min(5, "Give a short reason (at least 5 characters).").max(500),
});
export type OverridePhaseLockInput = z.infer<typeof OverridePhaseLockInput>;

/** Moving a main task into a phase, or out of every phase. Allowed even into a locked phase. */
export const SetMainTaskPhaseInput = z.object({
  id: id,
  phaseId: id.nullable(),
});
export type SetMainTaskPhaseInput = z.infer<typeof SetMainTaskPhaseInput>;

/* ------------------------------------------------------------------ */
/* Main tasks                                                          */
/* ------------------------------------------------------------------ */

const DisciplineSummaryItem = z.object({
  disciplineTaskId: id,
  title: z.string(),
  assigneeName: z.string().nullable(),
  /** Set when the assignee is a contractor, for the company badge on the row. */
  assigneeCompanyName: z.string().nullable().optional(),
  deadline: dateOut,
  isOverdue: z.boolean(),
  disciplineId: id,
  code: z.string(),
  colorHex: z.string(),
  status: TaskStatusSchema,
  /**
   * MANDATORY required documents only — the same set the completion gate looks at, so the row's
   * "2/3 documents" hint and "you can't complete this yet" always agree. Optional documents are
   * deliberately not counted here.
   */
  requiredDocsTotal: z.number().int().min(0),
  requiredDocsSatisfied: z.number().int().min(0),
});

export const MainTaskDTO = z.object({
  id: id,
  projectId: id,
  projectCode: z.string(),
  /** The stage gate this task sits behind. Null means unphased — never gated. */
  phaseId: id.nullable(),
  phaseName: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  startDate: dateOut.nullable(),
  deadline: dateOut,
  status: TaskStatusSchema,
  effectiveStatus: TaskStatusSchema,
  statusOverride: TaskStatusSchema.nullable(),
  overrideReason: z.string().nullable(),
  overriddenByName: z.string().nullable(),
  overriddenAt: dateOut.nullable(),
  progressPct: z.number().int(),
  isOverdue: z.boolean(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  createdById: id,
  createdByName: z.string(),
  createdAt: dateOut,
  disciplineSummary: z.array(DisciplineSummaryItem),
  counts: z.object({
    disciplineTasks: z.number().int(),
    completed: z.number().int(),
    documents: z.number().int(),
    comments: z.number().int(),
  }),
});
export type MainTaskDTO = z.infer<typeof MainTaskDTO>;

export const MainTaskListItemDTO = z.object({
  id: id,
  projectId: id,
  projectCode: z.string(),
  /** The stage gate this task sits behind, so a listing can be grouped by phase. */
  phaseId: id.nullable(),
  title: z.string(),
  priority: PrioritySchema,
  deadline: dateOut,
  effectiveStatus: TaskStatusSchema,
  hasOverride: z.boolean(),
  progressPct: z.number().int(),
  isOverdue: z.boolean(),
  counts: z.object({ disciplineTasks: z.number().int(), completed: z.number().int() }),
  disciplineSummary: z.array(DisciplineSummaryItem),
});
export type MainTaskListItemDTO = z.infer<typeof MainTaskListItemDTO>;

export const CreateMainTaskInput = z.object({
  projectId: id,
  /** Optional: the stage gate the task belongs to. Left out, the task is unphased. */
  phaseId: id.nullable().optional(),
  title: shortText,
  description: longText,
  priority: PrioritySchema.default("MEDIUM"),
  startDate: dateIn.nullable().optional(),
  deadline: dateIn,
  ownerId: id.nullable().optional(),
  disciplineTasks: z
    .array(
      z.object({
        disciplineId: id,
        title: shortText,
        description: longText.optional(),
        assigneeId: id.nullable().optional(),
        deadline: dateIn,
        isMandatory: z.boolean().default(true),
        requiredDocuments: z
          .array(z.object({ name: shortText, isMandatory: z.boolean().default(true) }))
          .max(50)
          .default([]),
      }),
    )
    .max(100)
    .default([]),
}).refine((value) => !value.startDate || value.startDate <= value.deadline, {
  message: "A task cannot end before it starts.",
  path: ["deadline"],
});
export type CreateMainTaskInput = z.infer<typeof CreateMainTaskInput>;

export const UpdateMainTaskInput = z.object({
  id: id,
  title: shortText.optional(),
  description: longText.optional(),
  priority: PrioritySchema.optional(),
  startDate: dateIn.nullable().optional(),
  deadline: dateIn.optional(),
  ownerId: id.nullable().optional(),
});
export type UpdateMainTaskInput = z.infer<typeof UpdateMainTaskInput>;

export const OverrideStatusInput = z.object({
  id: id,
  status: TaskStatusSchema,
  reason: z.string().trim().min(5, "Give a short reason (at least 5 characters).").max(500),
});
export type OverrideStatusInput = z.infer<typeof OverrideStatusInput>;

/* ------------------------------------------------------------------ */
/* Discipline tasks                                                    */
/* ------------------------------------------------------------------ */

export const RequiredDocumentDTO = z.object({
  id: id,
  name: z.string(),
  description: z.string().nullable(),
  isMandatory: z.boolean(),
  documentId: z.string().nullable(),
  satisfiedAt: dateOut.nullable(),
  isSatisfied: z.boolean(),
});
export type RequiredDocumentDTO = z.infer<typeof RequiredDocumentDTO>;

export const DisciplineTaskDTO = z.object({
  id: id,
  mainTaskId: id,
  mainTaskTitle: z.string(),
  projectId: id,
  projectCode: z.string(),
  disciplineId: id,
  disciplineCode: z.string(),
  disciplineName: z.string(),
  disciplineColorHex: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  /** Set when the assignee is a contractor — the screens show "«Company» · External" beside them. */
  assigneeCompanyName: z.string().nullable().optional(),
  startDate: dateOut.nullable(),
  deadline: dateOut,
  status: TaskStatusSchema,
  priority: PrioritySchema,
  isMandatory: z.boolean(),
  isOverdue: z.boolean(),
  completedAt: dateOut.nullable(),
  completedByName: z.string().nullable(),
  sortOrder: z.number().int(),
  requiredDocuments: z.array(RequiredDocumentDTO),
  dependencies: z.array(
    z.object({ id: id, title: z.string(), status: TaskStatusSchema, disciplineCode: z.string() }),
  ),
  blockers: z.array(z.string()),
  canComplete: z.boolean(),
});
export type DisciplineTaskDTO = z.infer<typeof DisciplineTaskDTO>;

export const UpdateDisciplineTaskInput = z.object({
  id: id,
  title: shortText.optional(),
  description: longText.nullable().optional(),
  assigneeId: id.nullable().optional(),
  startDate: dateIn.nullable().optional(),
  deadline: dateIn.optional(),
  priority: PrioritySchema.optional(),
  isMandatory: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
export type UpdateDisciplineTaskInput = z.infer<typeof UpdateDisciplineTaskInput>;

export const UpdateTaskStatusInput = z.object({
  id: id,
  status: TaskStatusSchema,
  note: z.string().trim().max(500).optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof UpdateTaskStatusInput>;

export const CreateDisciplineTaskInput = z.object({
  mainTaskId: id,
  disciplineId: id,
  title: shortText,
  description: longText.optional(),
  assigneeId: id.nullable().optional(),
  startDate: dateIn.nullable().optional(),
  deadline: dateIn,
  priority: PrioritySchema.default("MEDIUM"),
  isMandatory: z.boolean().default(true),
  requiredDocuments: z
    .array(z.object({ name: shortText, isMandatory: z.boolean().default(true) }))
    .max(50)
    .default([]),
}).refine((value) => !value.startDate || value.startDate <= value.deadline, {
  message: "A task cannot end before it starts.",
  path: ["deadline"],
});
export type CreateDisciplineTaskInput = z.infer<typeof CreateDisciplineTaskInput>;

export const AddDependencyInput = z.object({
  predecessorId: id,
  successorId: id,
});
export type AddDependencyInput = z.infer<typeof AddDependencyInput>;

export const UpdateTaskDatesInput = z
  .object({
    id: id,
    kind: z.enum(["MAIN", "DISCIPLINE"]),
    startDate: dateIn.nullable().optional(),
    deadline: dateIn,
  })
  .refine((value) => !value.startDate || value.startDate <= value.deadline, {
    message: "A task cannot end before it starts.",
    path: ["deadline"],
  });
export type UpdateTaskDatesInput = z.infer<typeof UpdateTaskDatesInput>;

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const DocumentVersionDTO = z.object({
  id: id,
  documentId: id,
  revisionNumber: z.number().int(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  checksumSha256: z.string(),
  uploadedById: id,
  uploadedByName: z.string(),
  note: z.string().nullable(),
  createdAt: dateOut,
  downloadUrl: z.string(),
});
export type DocumentVersionDTO = z.infer<typeof DocumentVersionDTO>;

export const DocumentDTO = z.object({
  id: id,
  projectId: id,
  mainTaskId: z.string().nullable(),
  disciplineTaskId: z.string().nullable(),
  title: z.string(),
  category: z.string().nullable(),
  uploadedById: id,
  uploadedByName: z.string(),
  /** Set when the person who uploaded it is a contractor. */
  uploadedByCompanyName: z.string().nullable().optional(),
  createdAt: dateOut,
  currentRevision: DocumentVersionDTO.nullable(),
  versionsCount: z.number().int(),
});
export type DocumentDTO = z.infer<typeof DocumentDTO>;

export const UploadMeta = z.object({
  projectId: id,
  mainTaskId: id.nullable().optional(),
  disciplineTaskId: id.nullable().optional(),
  documentId: id.nullable().optional(),
  requiredDocumentId: id.nullable().optional(),
  title: shortText.optional(),
  category: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
});
export type UploadMeta = z.infer<typeof UploadMeta>;

/* ------------------------------------------------------------------ */
/* Comments, notifications, activity                                   */
/* ------------------------------------------------------------------ */

/**
 * What marks a department mention inside `Comment.mentions`.
 *
 * The schema is frozen, so the same `String[]` column carries both shapes: a bare id is a person,
 * `"d:<disciplineId>"` is a whole department. The colon can never collide with a person's id
 * because every id in this app is a cuid, which is letters and digits only.
 */
export const DISCIPLINE_MENTION_PREFIX = "d:";

/** The stored token for a department mention. */
export function disciplineMentionToken(disciplineId: string): string {
  return `${DISCIPLINE_MENTION_PREFIX}${disciplineId}`;
}

/** The discipline a stored mention points at, or null when the mention is a person. */
export function disciplineMentionTarget(mention: string): string | null {
  return mention.startsWith(DISCIPLINE_MENTION_PREFIX)
    ? mention.slice(DISCIPLINE_MENTION_PREFIX.length)
    : null;
}

/**
 * An id somebody sent us as a mention. The colon is refused so a browser can never post a
 * ready-made `"d:..."` token: department mentions arrive in their own field and only the service
 * writes the prefix, after it has checked the department really is on this project.
 */
const mentionId = id.refine(
  (value) => !value.includes(":"),
  "That is not somebody we can mention.",
);

export const CommentDTO = z.object({
  id: id,
  body: z.string(),
  authorId: id,
  authorName: z.string(),
  /** Set when the author is a contractor. */
  authorCompanyName: z.string().nullable().optional(),
  mainTaskId: z.string().nullable(),
  disciplineTaskId: z.string().nullable(),
  /**
   * Who was mentioned: a person's id, or `"d:<disciplineId>"` for a whole department. A reader
   * tells the two apart with `disciplineMentionTarget()` and resolves the name from the project's
   * own disciplines, which every screen showing a thread already has.
   */
  mentions: z.array(z.string()),
  editedAt: dateOut.nullable(),
  createdAt: dateOut,
  /** Tombstone: a removed comment stays in the thread with its body replaced. */
  isDeleted: z.boolean().optional(),
});
export type CommentDTO = z.infer<typeof CommentDTO>;

export const CreateCommentInput = z
  .object({
    body: z.string().trim().min(1, "Write something first.").max(5000),
    mainTaskId: id.nullable().optional(),
    disciplineTaskId: id.nullable().optional(),
    mentions: z.array(mentionId).max(50).default([]),
    /**
     * Departments mentioned in this comment, as plain discipline ids. They are kept apart from the
     * people so the input says exactly what it means; the service checks each one is on this
     * project and only then folds it into the stored `mentions` array as a `"d:"` token. Optional
     * rather than defaulted, so a caller that mentions nobody's department says nothing at all.
     */
    disciplineMentions: z.array(mentionId).max(20).optional(),
  })
  .refine(
    (value) => Boolean(value.mainTaskId) !== Boolean(value.disciplineTaskId),
    "A comment belongs to either a main task or a discipline task, not both.",
  );
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const NotificationDTO = z.object({
  id: id,
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  linkUrl: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  readAt: dateOut.nullable(),
  createdAt: dateOut,
});
export type NotificationDTO = z.infer<typeof NotificationDTO>;

/** What /api/notifications/unread-count returns — the number on the bell, nothing else. */
export const UnreadCountDTO = z.object({ unread: z.number().int().min(0) });
export type UnreadCountDTO = z.infer<typeof UnreadCountDTO>;

export const ActivityItemDTO = z.object({
  id: id,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  projectId: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  summary: z.string(),
  createdAt: dateOut,
});
export type ActivityItemDTO = z.infer<typeof ActivityItemDTO>;

/* ------------------------------------------------------------------ */
/* Search, dashboard, Gantt                                            */
/* ------------------------------------------------------------------ */

export const SearchResultsDTO = z.object({
  projects: z.array(ProjectListItemDTO),
  mainTasks: z.array(MainTaskListItemDTO),
  disciplineTasks: z.array(
    z.object({
      id: id,
      title: z.string(),
      mainTaskId: id,
      projectId: id,
      disciplineCode: z.string(),
      status: TaskStatusSchema,
      deadline: dateOut,
    }),
  ),
  users: z.array(UserDTO),
  documents: z.array(DocumentDTO),
});
export type SearchResultsDTO = z.infer<typeof SearchResultsDTO>;

export const DashboardDTO = z.object({
  counts: z.object({
    total: z.number().int(),
    inProgress: z.number().int(),
    completed: z.number().int(),
    blocked: z.number().int(),
    overdue: z.number().int(),
    dueSoon: z.number().int(),
  }),
  myTasks: z.array(
    z.object({
      id: id,
      title: z.string(),
      projectCode: z.string(),
      mainTaskId: id,
      disciplineCode: z.string(),
      disciplineColorHex: z.string(),
      status: TaskStatusSchema,
      priority: PrioritySchema,
      deadline: dateOut,
      isOverdue: z.boolean(),
    }),
  ),
  /**
   * Work an external contractor has handed in that THIS person can sign off — empty for everybody
   * who reviews nothing, and always empty for a contractor.
   */
  awaitingMySignoff: z
    .array(
      z.object({
        id: id,
        title: z.string(),
        projectCode: z.string(),
        mainTaskId: id,
        disciplineCode: z.string(),
        disciplineColorHex: z.string(),
        deadline: dateOut,
        isOverdue: z.boolean(),
        assigneeName: z.string().nullable(),
        assigneeCompanyName: z.string().nullable(),
      }),
    )
    .default([]),
  disciplineProgress: z.array(
    z.object({
      disciplineId: id,
      code: z.string(),
      name: z.string(),
      colorHex: z.string(),
      pct: z.number().int(),
    }),
  ),
  upcomingDeadlines: z.array(
    z.object({
      id: id,
      kind: z.enum(["MAIN", "DISCIPLINE"]),
      title: z.string(),
      projectCode: z.string(),
      deadline: dateOut,
      status: TaskStatusSchema,
      isOverdue: z.boolean(),
    }),
  ),
  recentActivity: z.array(ActivityItemDTO),
});
export type DashboardDTO = z.infer<typeof DashboardDTO>;

export const GanttDTO = z.object({
  mainTasks: z.array(
    z.object({
      id: id,
      title: z.string(),
      /**
       * The stage gate this bar sits behind, so the project timeline can draw phase bands.
       * Left out entirely by the schedules that have no project to band (My tasks).
       */
      phaseId: id.nullable().optional(),
      startDate: dateOut.nullable(),
      deadline: dateOut,
      status: TaskStatusSchema,
      progressPct: z.number().int(),
      disciplineTasks: z.array(
        z.object({
          id: id,
          title: z.string(),
          disciplineCode: z.string(),
          disciplineColorHex: z.string(),
          assigneeName: z.string().nullable(),
          startDate: dateOut.nullable(),
          deadline: dateOut,
          status: TaskStatusSchema,
        }),
      ),
    }),
  ),
});
export type GanttDTO = z.infer<typeof GanttDTO>;

/* ------------------------------------------------------------------ */
/* The standard result shape for every mutation                        */
/* ------------------------------------------------------------------ */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Turns a failed zod parse into the standard failure shape, in plain English. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    out[key] = [...(out[key] ?? []), issue.message];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sidebar: favorites, the personal list, and My tasks                 */
/* ------------------------------------------------------------------ */

export const FavoriteTargetSchema = z.enum(["PROJECT", "MAIN_TASK", "DISCIPLINE_TASK"]);
export type FavoriteTargetName = z.infer<typeof FavoriteTargetSchema>;

export const ToggleFavoriteInput = z.object({
  targetType: FavoriteTargetSchema,
  targetId: id,
});
export type ToggleFavoriteInput = z.infer<typeof ToggleFavoriteInput>;

/**
 * One shortcut in the sidebar, carrying everything the link needs so the client never asks again:
 * PROJECT → `/projects/{targetId}`, MAIN_TASK → `/tasks/{targetId}`,
 * DISCIPLINE_TASK → `/discipline-tasks/{targetId}`. `projectCode` is shown beside all three.
 */
export const FavoriteDTO = z.object({
  id: id,
  targetType: FavoriteTargetSchema,
  targetId: id,
  title: z.string(),
  projectCode: z.string().nullable(),
  /** The project the favorite belongs to — null only if the project has since gone. */
  projectId: id.nullable(),
  /** The parent main task, for a discipline task favorite. Null for the other two kinds. */
  mainTaskId: id.nullable(),
  createdAt: dateOut,
});
export type FavoriteDTO = z.infer<typeof FavoriteDTO>;

export const CreatePersonalTaskInput = z.object({ title: shortText });
export type CreatePersonalTaskInput = z.infer<typeof CreatePersonalTaskInput>;

export const TogglePersonalTaskInput = z.object({ id: id });
export type TogglePersonalTaskInput = z.infer<typeof TogglePersonalTaskInput>;

export const DeletePersonalTaskInput = z.object({ id: id });
export type DeletePersonalTaskInput = z.infer<typeof DeletePersonalTaskInput>;

/** A line on a person's own to-do list. Private to them and never part of the audit trail. */
export const PersonalTaskDTO = z.object({
  id: id,
  title: z.string(),
  done: z.boolean(),
  completedAt: dateOut.nullable(),
  createdAt: dateOut,
});
export type PersonalTaskDTO = z.infer<typeof PersonalTaskDTO>;

/** The dashboard's "my tasks" row plus the start date the full My tasks screen shows. */
export const MyTaskItemDTO = z.object({
  id: id,
  title: z.string(),
  projectCode: z.string(),
  mainTaskId: id,
  disciplineCode: z.string(),
  disciplineColorHex: z.string(),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  startDate: dateOut.nullable(),
  deadline: dateOut,
  isOverdue: z.boolean(),
  /** Who did the work — filled in on the sign-off queue, where it is somebody else's task. */
  assigneeName: z.string().nullable().optional(),
  /** Their company, when they are a contractor. */
  assigneeCompanyName: z.string().nullable().optional(),
});
export type MyTaskItemDTO = z.infer<typeof MyTaskItemDTO>;

/**
 * Everything assigned to the signed-in person, completed work included. `totals` are counted in the
 * database over all of it, so they stay true even when the list itself has been cut short
 * (`truncated`).
 */
export const MyTasksDTO = z.object({
  tasks: z.array(MyTaskItemDTO),
  totals: z.object({
    NOT_STARTED: z.number().int(),
    IN_PROGRESS: z.number().int(),
    BLOCKED: z.number().int(),
    AWAITING_REVIEW: z.number().int(),
    COMPLETED: z.number().int(),
  }),
  truncated: z.boolean(),
});
export type MyTasksDTO = z.infer<typeof MyTasksDTO>;

/* ------------------------------------------------------------------ */
/* Daily briefs (computed from what the app already records)           */
/* ------------------------------------------------------------------ */

/**
 * One line in a brief. Everything is computed from data already in the database — there is no new
 * personal data here and nothing is written by a brief.
 */
export const BriefItemDTO = z.object({
  id: id,
  title: z.string(),
  /**
   * Where the line goes: "/tasks/…" for a main task, "/discipline-tasks/…" for a discipline one.
   * **Empty means there is nowhere to go** and the screen draws the title as plain text — a
   * contractor's notice is the whole thing, and every page it could point at is one they may not
   * read.
   */
  linkUrl: z.string(),
  projectCode: z.string(),
  disciplineCode: z.string().nullable(),
  deadline: dateOut.nullable(),
  /** Whole days past the deadline day. Only the overdue section fills this in. */
  daysOverdue: z.number().int().nullable(),
  /**
   * The full text of the thing, where the line IS the thing rather than a pointer to it — a
   * contractor's notice, which has no page of its own to open. Null on every task line.
   */
  body: z.string().nullable(),
  /** Why the line is here, in plain English — the unblocked and mention sections use it. */
  note: z.string().nullable(),
  /** When the thing that put this line here happened. Null where there is no such moment. */
  at: dateOut.nullable(),
});
export type BriefItemDTO = z.infer<typeof BriefItemDTO>;

/**
 * One section of a brief: the rows the screen shows, and the true count behind them. `total` is
 * counted over everything that qualifies, so a capped list never makes the number a lie.
 */
export const BriefSectionDTO = z.object({
  items: z.array(BriefItemDTO),
  total: z.number().int(),
});
export type BriefSectionDTO = z.infer<typeof BriefSectionDTO>;

/**
 * "Your day": one person's own work, computed on the server. `since` is the start of the 24-hour
 * window the newly-unblocked and mentions sections cover, so every section can state its own window
 * on screen.
 */
export const BriefDTO = z.object({
  generatedAt: dateOut,
  since: dateOut,
  dueToday: BriefSectionDTO,
  overdue: BriefSectionDTO,
  newlyUnblocked: BriefSectionDTO,
  mentions: BriefSectionDTO,
  awaitingReview: BriefSectionDTO,
  /**
   * The announcements still running for the audiences this person belongs to. A brief line has no
   * project of its own here, so `projectCode` carries the audience label ("Everyone", "PH-1",
   * "Electrical") — the same chip the noticeboard shows — and `deadline` carries the expiry date.
   * Dismissing one on the dashboard does not hide it here: this is a summary of what is running.
   */
  announcements: BriefSectionDTO,
  /**
   * The running announcements that asked THIS person to confirm they have read them and that they
   * have not confirmed yet. A subset of `announcements`, kept separate because it is the only part
   * of a brief that is still waiting on the reader. Always empty for a contractor, who has no
   * noticeboard and cannot acknowledge anything.
   */
  awaitingAcknowledgement: BriefSectionDTO,
});
export type BriefDTO = z.infer<typeof BriefDTO>;

/**
 * Progress now against progress seven days ago. The earlier number is DERIVED from the completion
 * timestamps the app already keeps (a main task's completion moment is the last of its discipline
 * tasks to finish, or the moment an authorised override was recorded) — there is no snapshot table
 * and no stored history.
 *
 * The comparison is made between the tasks that existed then: `totalThen` leaves out anything
 * created inside the week, so adding work to a project can never make its progress appear to fall,
 * and work reopened inside the week is counted as it stood before it was reopened.
 */
export const ProjectBriefProgressDTO = z.object({
  completed: z.number().int(),
  total: z.number().int(),
  pct: z.number().int(),
  completedThen: z.number().int(),
  /** How many main tasks existed seven days ago — the basis `pctThen` is a percentage of. */
  totalThen: z.number().int(),
  pctThen: z.number().int(),
  /** The moment "seven days ago" means, so the screen can name the day. */
  since: dateOut,
});
export type ProjectBriefProgressDTO = z.infer<typeof ProjectBriefProgressDTO>;

/** A blocked discipline task, with the work it is still waiting on named. */
export const BriefBlockedTaskDTO = z.object({
  id: id,
  title: z.string(),
  linkUrl: z.string(),
  disciplineCode: z.string(),
  mainTaskTitle: z.string(),
  unmetDependencies: z.array(z.string()),
});
export type BriefBlockedTaskDTO = z.infer<typeof BriefBlockedTaskDTO>;

/** A shut gate and the phase that is holding it shut. Locked is derived, never stored. */
export const BriefLockedPhaseDTO = z.object({
  id: id,
  name: z.string(),
  lockedByPhaseName: z.string().nullable(),
  openTaskCount: z.number().int(),
});
export type BriefLockedPhaseDTO = z.infer<typeof BriefLockedPhaseDTO>;

/** How much late work each discipline is carrying. Overdue is derived at read time, as always. */
export const BriefOverdueByDisciplineDTO = z.object({
  disciplineCode: z.string(),
  disciplineColorHex: z.string(),
  count: z.number().int(),
});
export type BriefOverdueByDisciplineDTO = z.infer<typeof BriefOverdueByDisciplineDTO>;

/** What keeps the next gate shut: the unfinished main tasks of the earliest phase with open work. */
export const BriefNextGateDTO = z.object({
  phaseId: id,
  phaseName: z.string(),
  items: z.array(BriefItemDTO),
  total: z.number().int(),
});
export type BriefNextGateDTO = z.infer<typeof BriefNextGateDTO>;

/** "Where we stand": one project, computed. Every member of the project may read it. */
export const ProjectBriefDTO = z.object({
  projectId: id,
  projectCode: z.string(),
  projectName: z.string(),
  generatedAt: dateOut,
  progress: ProjectBriefProgressDTO,
  blockedTasks: z.array(BriefBlockedTaskDTO),
  blockedTotal: z.number().int(),
  lockedPhases: z.array(BriefLockedPhaseDTO),
  overdueByDiscipline: z.array(BriefOverdueByDisciplineDTO),
  overdueTotal: z.number().int(),
  nextGate: BriefNextGateDTO.nullable(),
  /** Unphased work, nearest deadlines first — the part of "what next" no gate speaks for. */
  nearestDeadlines: z.array(BriefItemDTO),
});
export type ProjectBriefDTO = z.infer<typeof ProjectBriefDTO>;

/* ------------------------------------------------------------------ */
/* Chat integrations (Slack and Microsoft Teams)                       */
/* ------------------------------------------------------------------ */

/**
 * Which chat tool a webhook belongs to. A zod enum over a plain string column, NOT a database
 * enum: adding a third tool later needs no migration.
 */
export const IntegrationKindSchema = z.enum(["SLACK", "TEAMS"]);
export type IntegrationKindName = z.infer<typeof IntegrationKindSchema>;

/**
 * The events an organisation can switch on or off for a chat channel.
 *
 * The first five are notification copies — each one is what a `NotificationType` maps to. The sixth,
 * `dailyBrief`, is NOT a notification fan-out at all: it is the once-a-day digest of work the app
 * has already recorded, and nothing in the app ever writes a notification of that kind. See
 * `TOGGLE_FOR_TYPE` in src/server/services/webhooks.ts, which the compiler stops from mapping
 * anything to it.
 */
export const IntegrationEventSchema = z.enum([
  "taskAssigned",
  "mention",
  "statusChange",
  "overdueReminder",
  "gateOverride",
  "announcements",
  "dailyBrief",
]);
export type IntegrationEventName = z.infer<typeof IntegrationEventSchema>;

/**
 * Every event, on or off, so a saved map is never half-defined.
 *
 * `dailyBrief` carries a default of `false` on purpose: rows saved before the digest existed have
 * five keys, and without the default they would stop parsing — which would silently switch a
 * company's whole chat delivery off. An old row therefore reads as "digest off", which is also what
 * a brand-new one gets.
 */
export const IntegrationEventToggles = z.object({
  taskAssigned: z.boolean(),
  mention: z.boolean(),
  statusChange: z.boolean(),
  overdueReminder: z.boolean(),
  gateOverride: z.boolean(),
  /**
   * The noticeboard copy. It carries a default for exactly the reason `dailyBrief` does: rows saved
   * before announcements existed have six keys or fewer, and without the default they would stop
   * parsing — which would silently switch a company's whole chat delivery off. Default OFF, so a
   * company only ever posts announcements into a channel because somebody asked for it.
   */
  announcements: z.boolean().default(false),
  dailyBrief: z.boolean().default(false),
});
export type IntegrationEventToggles = z.infer<typeof IntegrationEventToggles>;

/**
 * What a brand-new integration starts with: the five notification copies on, the daily digest off,
 * and the channel itself still disabled. The digest is a scheduled post into somebody's channel, so
 * it is only ever there because an administrator asked for it.
 */
export const DEFAULT_EVENT_TOGGLES: IntegrationEventToggles = {
  taskAssigned: true,
  mention: true,
  statusChange: true,
  overdueReminder: true,
  gateOverride: true,
  announcements: false,
  dailyBrief: false,
};

/**
 * The host rules a webhook URL must satisfy, per kind. This is BOTH the form validation and the
 * SSRF guard: `webhookUrlProblem` is called again at delivery time, on the stored value, so a URL
 * that somehow got into the database another way is still never called.
 */
const WEBHOOK_RULES: Record<
  IntegrationKindName,
  { host: (host: string) => boolean; path: (path: string) => boolean; message: string }
> = {
  SLACK: {
    host: (host) => host === "hooks.slack.com",
    path: (path) => path.startsWith("/services/") && path.length > "/services/".length,
    message:
      "That does not look like a Slack webhook address. It should start with https://hooks.slack.com/services/",
  },
  TEAMS: {
    host: (host) => host.endsWith(".logic.azure.com") || host.endsWith(".logic.azure.us"),
    path: (path) => path.includes("/workflows/") && path.includes("/triggers/"),
    message:
      "That does not look like a Teams Workflows address. It should be the https link Teams gave you, containing logic.azure.com and /triggers/manual/paths/invoke",
  },
};

/**
 * Checks a pasted webhook address. Returns a plain-English problem, or null when it is fine.
 * Only https is ever accepted, and only the hosts above — nothing else may be called.
 */
export function webhookUrlProblem(kind: IntegrationKindName, value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Paste the whole web address, starting with https://";
  }
  if (url.protocol !== "https:") return "The address must start with https://";
  if (url.username || url.password) return "Remove the username and password from the address.";
  // `url.port` is empty for the default https port — Teams addresses are written with ":443" and
  // the parser drops it. Anything else is a port nobody's chat webhook listens on, so it is refused
  // rather than dialled.
  if (url.port) return "Remove the port number from the address.";

  const rule = WEBHOOK_RULES[kind];
  if (!rule.host(url.hostname.toLowerCase())) return rule.message;
  if (!rule.path(url.pathname)) return rule.message;
  return null;
}

/**
 * All the admin screen is ever told about a saved address: scheme and host, then an ellipsis.
 * The secret part of the URL is never sent back to a browser once it has been saved.
 */
export function maskWebhookUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return "…";
  }
}

const webhookUrlField = z
  .string()
  .trim()
  .min(1, "Paste the webhook address you copied.")
  .max(500, "That address is too long to be a webhook address.");

/** Pasting (or re-pasting) an address. Changing the address always means pasting it again. */
export const SaveIntegrationInput = z
  .object({
    kind: IntegrationKindSchema,
    webhookUrl: webhookUrlField,
    eventToggles: IntegrationEventToggles.optional(),
  })
  .superRefine((value, ctx) => {
    const problem = webhookUrlProblem(value.kind, value.webhookUrl);
    if (problem) ctx.addIssue({ code: "custom", path: ["webhookUrl"], message: problem });
  });
export type SaveIntegrationInput = z.infer<typeof SaveIntegrationInput>;

export const SetIntegrationEnabledInput = z.object({
  kind: IntegrationKindSchema,
  enabled: z.boolean(),
});
export type SetIntegrationEnabledInput = z.infer<typeof SetIntegrationEnabledInput>;

export const SetEventTogglesInput = z.object({
  kind: IntegrationKindSchema,
  eventToggles: IntegrationEventToggles,
});
export type SetEventTogglesInput = z.infer<typeof SetEventTogglesInput>;

export const IntegrationKindInput = z.object({ kind: IntegrationKindSchema });
export type IntegrationKindInput = z.infer<typeof IntegrationKindInput>;

/**
 * One chat channel as the Admin screen sees it. `webhookUrlMasked` is scheme and host only —
 * **the saved address is never returned by any read**, so changing it means pasting it again.
 */
export const OrgIntegrationDTO = z.object({
  kind: IntegrationKindSchema,
  configured: z.boolean(),
  enabled: z.boolean(),
  webhookUrlMasked: z.string().nullable(),
  eventToggles: IntegrationEventToggles,
  updatedAt: dateOut.nullable(),
});
export type OrgIntegrationDTO = z.infer<typeof OrgIntegrationDTO>;

/** What "Send test message" comes back with. Never carries the address or a provider error body. */
export const IntegrationTestResultDTO = z.object({
  kind: IntegrationKindSchema,
  delivered: z.boolean(),
  message: z.string(),
});
export type IntegrationTestResultDTO = z.infer<typeof IntegrationTestResultDTO>;

/* ------------------------------------------------------------------ */
/* Microsoft 365 files (OneDrive and SharePoint)                       */
/* ------------------------------------------------------------------ */

/**
 * Graph ids are opaque strings from Microsoft, longer than our own cuids and put straight into a
 * request path — so anything that could change the shape of that path is refused here, once, and
 * the same helper is used again before any outbound call (src/lib/ms-graph.ts).
 */
export function isSafeGraphId(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[/?#%\\\s]/.test(value);
}

const graphId = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(isSafeGraphId, "That file reference is not usable.");

/**
 * One company's Microsoft 365 connection, as the Admin screen sees it. No token, no tenant secret
 * and no file address is ever part of this shape.
 */
export const MicrosoftConnectionDTO = z.object({
  /** Whether this Tielora has an Azure app registered at all. False means the card is not shown. */
  available: z.boolean(),
  /** Whether APP_BASE_URL is set, which is what the callback address is built from. */
  callbackReady: z.boolean(),
  connected: z.boolean(),
  /** The work domain of the account that connected, e.g. "contoso.com". Never a person's address. */
  tenantDomain: z.string().nullable(),
  connectedByName: z.string().nullable(),
  connectedAt: dateOut.nullable(),
  /** True once Microsoft has stopped accepting the saved token — an administrator must reconnect. */
  needsReconnect: z.boolean(),
});
export type MicrosoftConnectionDTO = z.infer<typeof MicrosoftConnectionDTO>;

/** One place files live: the person's own OneDrive, or a SharePoint document library. */
export const MicrosoftDriveDTO = z.object({
  id: graphId,
  name: z.string(),
  /** "OneDrive" or the SharePoint site's name — plain English for the picker's list. */
  location: z.string(),
});
export type MicrosoftDriveDTO = z.infer<typeof MicrosoftDriveDTO>;

/** One row in the file picker: a folder to open, or a file to attach. */
export const MicrosoftItemDTO = z.object({
  id: graphId,
  name: z.string(),
  isFolder: z.boolean(),
  sizeBytes: z.number().nullable(),
  lastModifiedAt: dateOut.nullable(),
  /** Larger than the 25 MB upload limit, so the picker can say so before anyone waits. */
  tooLarge: z.boolean(),
});
export type MicrosoftItemDTO = z.infer<typeof MicrosoftItemDTO>;

/**
 * What one step of browsing (or one search) answers with. The picker keeps its own breadcrumb from
 * the folders it walked through, so the server never spends a second Graph call re-reading names it
 * has just handed over.
 */
export const MicrosoftListingDTO = z.object({
  driveId: graphId,
  driveName: z.string(),
  /** The folder being shown, or null for the top of the drive. */
  folderId: graphId.nullable(),
  items: z.array(MicrosoftItemDTO),
  /** True when Microsoft had more rows than one page shows. */
  truncated: z.boolean(),
});
export type MicrosoftListingDTO = z.infer<typeof MicrosoftListingDTO>;

/**
 * Where an attachment would go. Exactly the fields the upload dialog already sends, because the
 * browse endpoints check the SAME permission an upload does before they show a single file name.
 */
export const MicrosoftTargetInput = UploadMeta.omit({ title: true, category: true, note: true });
export type MicrosoftTargetInput = z.infer<typeof MicrosoftTargetInput>;

export const MicrosoftBrowseInput = MicrosoftTargetInput.extend({
  driveId: graphId.optional(),
  /** The folder being opened. Absent means the drive's root. */
  itemId: graphId.optional(),
});
export type MicrosoftBrowseInput = z.infer<typeof MicrosoftBrowseInput>;

export const MicrosoftSearchInput = MicrosoftTargetInput.extend({
  driveId: graphId,
  q: z.string().trim().min(2, "Type at least two characters to search.").max(100),
});
export type MicrosoftSearchInput = z.infer<typeof MicrosoftSearchInput>;

/** Attaching one picked file. Everything an upload carries, plus which file to fetch. */
export const AttachMicrosoftFileInput = UploadMeta.extend({
  driveId: graphId,
  itemId: graphId,
});
export type AttachMicrosoftFileInput = z.infer<typeof AttachMicrosoftFileInput>;

/* ------------------------------------------------------------------ */
/* The noticeboard: announcements and the department board             */
/* ------------------------------------------------------------------ */

/**
 * Who a post is aimed at. The three shapes are exactly the three the `Post` row can hold:
 * neither id set (the whole company), a project, or a discipline. Never both ids at once.
 */
export const PostAudienceKindSchema = z.enum(["EVERYONE", "PROJECT", "DISCIPLINE"]);
export type PostAudienceKindName = z.infer<typeof PostAudienceKindSchema>;

/**
 * One audience as a screen shows it: the tab, the chip on a card, and whether this person may post
 * or moderate there. `key` is what the address bar carries (`/messages?tab=<key>`).
 */
export const PostAudienceDTO = z.object({
  key: z.string(),
  kind: PostAudienceKindSchema,
  projectId: z.string().nullable(),
  disciplineId: z.string().nullable(),
  /** "Everyone", a project code ("PH-1"), or a discipline name ("Electrical"). */
  label: z.string(),
  /** The discipline's own colour, so a department chip matches its dot. Null elsewhere. */
  colorHex: z.string().nullable(),
  canPost: z.boolean(),
  canModerate: z.boolean(),
});
export type PostAudienceDTO = z.infer<typeof PostAudienceDTO>;

/**
 * The most names the outstanding list on an announcement ever shows before it says "+N more".
 * The same shape a brief section takes: a capped list beside a true total.
 */
export const OUTSTANDING_ACK_LIMIT = 20;

/**
 * How an announcement that asked for acknowledgement is going — **for its author and for an
 * administrator only**. Nobody else is ever sent this block, so a colleague can never see who has
 * and has not confirmed.
 *
 * `audienceCount` is the INTERNAL audience of the post: everybody the announcement was sent to.
 * Contractors are never in it, even on a notice that included them — they have no Acknowledge
 * button, so counting them would make a total nobody could ever finish.
 */
export const PostAckProgressDTO = z.object({
  ackCount: z.number().int(),
  audienceCount: z.number().int(),
  /** Who has not acknowledged yet, by name, alphabetically, capped at `OUTSTANDING_ACK_LIMIT`. */
  outstandingNames: z.array(z.string()),
  /** How many are outstanding in total, so the list can say "+N more" honestly. */
  outstandingTotal: z.number().int(),
});
export type PostAckProgressDTO = z.infer<typeof PostAckProgressDTO>;

/** One post or one reply. A removed post keeps its place and loses its text, exactly like a comment. */
export const PostDTO = z.object({
  id: id,
  kind: PostKindSchema,
  audience: PostAudienceDTO.pick({
    key: true,
    kind: true,
    projectId: true,
    disciplineId: true,
    label: true,
    colorHex: true,
  }),
  title: z.string().nullable(),
  body: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  authorCompanyName: z.string().nullable(),
  parentId: z.string().nullable(),
  expiresAt: dateOut.nullable(),
  editedAt: dateOut.nullable(),
  isDeleted: z.boolean(),
  /** This person has hidden this announcement from their own dashboard. Their state, nobody else's. */
  dismissed: z.boolean(),
  /**
   * This announcement asks its audience to confirm they have read it. Announcements only; a board
   * post is always false.
   */
  requiresAck: z.boolean(),
  /** This person has acknowledged it. Their own state — never anybody else's. */
  acked: z.boolean(),
  /** When they did, so the card can say "You acknowledged this · 2 hours ago". Null until they do. */
  ackedAt: dateOut.nullable(),
  /**
   * How the acknowledgements are going. **Null for everybody but the author and an administrator**,
   * which is what stops the audience seeing each other's status — the same server-computed shape
   * `canEdit` and `canDelete` take.
   */
  ackProgress: PostAckProgressDTO.nullable(),
  /** What this person may do with this post, worked out on the server. */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  createdAt: dateOut,
});
export type PostDTO = z.infer<typeof PostDTO>;

/**
 * The one document a board post points at, as the chip on the card shows it.
 *
 * **Resolved through the READER'S own visibility, every time the card is read.** It is `null` on the
 * post whenever this person may not see the document — soft-deleted since it was attached, a project
 * they are not on, or any other reason — and the card then draws nothing at all: no placeholder, no
 * greyed chip, no title. A thing you may not see does not exist on your screen, which is the same
 * discretion "not found, never forbidden" carries everywhere else.
 *
 * `revision` is the document's latest revision number, so the chip can say "Rev 3" the way the
 * documents table does. `linkUrl` is worked out on the server for the same reason `canEdit` is:
 * there is no standalone document page in this app, so a chip has to point at the task the document
 * is filed under, and only the server knows which.
 */
export const PostAttachmentDTO = z.object({
  id: id,
  title: z.string(),
  revision: z.number().int(),
  linkUrl: z.string(),
});
export type PostAttachmentDTO = z.infer<typeof PostAttachmentDTO>;

/** A board post with its replies. Replies are one level deep, always, and never carry their own. */
export const BoardPostDTO = PostDTO.extend({
  replies: z.array(PostDTO),
  /**
   * The document this conversation points at, or `null` — which means either nothing was attached
   * or this reader may not see what was. The two are deliberately indistinguishable.
   */
  attachment: PostAttachmentDTO.nullable(),
});
export type BoardPostDTO = z.infer<typeof BoardPostDTO>;

/**
 * Starting a post. The audience is the pair of ids: neither set is the whole company, one set is
 * that project or that discipline, and both set is refused.
 */
export const CreatePostInput = z.object({
  kind: PostKindSchema,
  projectId: id.nullish(),
  disciplineId: id.nullish(),
  title: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1, "Write something first.").max(5000),
  /** Announcements only: the day it stops being shown. */
  expiresAt: dateIn.nullish(),
  /**
   * Announcements only, and only from an ADMIN or a PROJECT_MANAGER: ask the audience to confirm
   * they have read it. Optional in exactly the way `expiresAt` above is — left out (or null) means
   * "no", which is what every post written before this existed means, and the service reads it that
   * way rather than trusting the browser to send a false.
   */
  requiresAck: z.boolean().nullish(),
  /**
   * Announcements only, and only to the whole company or to one project: this notice also reaches
   * the contractors working there. Never a department (a contractor belongs to no department the
   * way a colleague does) and never a board (a contractor has no boards at all). Optional in
   * exactly the way `requiresAck` above is — left out, or null, means "no", which is what every
   * announcement written before this existed means.
   *
   * It changes who is TOLD and nothing else: contractors are still never counted in an
   * acknowledgement total, never given an Acknowledge button, and never let onto the noticeboard.
   */
  includeExternals: z.boolean().nullish(),
  /**
   * BOARD root posts on a PROJECT board only: one document that already exists on that project.
   * The service proves it is live, belongs to THAT project and is one this author may see — a
   * document that is any of those things is **not found**, never "you may not".
   */
  documentId: id.nullish(),
});
export type CreatePostInput = z.infer<typeof CreatePostInput>;

/** Replying to a board post. One level only — a reply's parent is always a root post. */
export const ReplyToPostInput = z.object({
  parentId: id,
  body: z.string().trim().min(1, "Write something first.").max(5000),
});
export type ReplyToPostInput = z.infer<typeof ReplyToPostInput>;

export const EditPostInput = z.object({
  id: id,
  title: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1, "Write something first.").max(5000),
});
export type EditPostInput = z.infer<typeof EditPostInput>;

export const DeletePostInput = z.object({ id: id });
export type DeletePostInput = z.infer<typeof DeletePostInput>;

/** Hiding one announcement from your own dashboard. Personal state, never an audit row. */
export const DismissAnnouncementInput = z.object({ id: id });
export type DismissAnnouncementInput = z.infer<typeof DismissAnnouncementInput>;

/**
 * Confirming you have read an announcement that asked for it. The opposite of a dismissal in every
 * way that matters: it is an attestation somebody relies on, so it IS audited.
 */
export const AcknowledgePostInput = z.object({ id: id });
export type AcknowledgePostInput = z.infer<typeof AcknowledgePostInput>;

export const SetBroadcastPolicyInput = z.object({ policy: BroadcastPolicySchema });
export type SetBroadcastPolicyInput = z.infer<typeof SetBroadcastPolicyInput>;

/** The company's noticeboard setting, as the Admin screen sees it. */
export const BroadcastSettingDTO = z.object({ policy: BroadcastPolicySchema });
export type BroadcastSettingDTO = z.infer<typeof BroadcastSettingDTO>;

/* ------------------------------------------------------------------ */
/* Emailed links (invitations, password resets, verification)          */
/* ------------------------------------------------------------------ */

/**
 * What a single-use token is for. A zod enum over a plain string column, NOT a database enum — the
 * same choice `IntegrationKindSchema` and `PostKindSchema` made, so a fifth kind needs no
 * migration.
 *
 * **"EXPORT" and "TWOFA_PENDING" are the two that are never emailed.** EXPORT is the download
 * bearer for a finished workspace export; TWOFA_PENDING is the short-lived proof that somebody's
 * password was accepted a moment ago and they are now being asked for their six digits. Both are
 * the same hashed, expiring, single-use, per-person row an emailed link uses, handed straight to
 * the person on the screen they are already looking at. `EmailedPurposeName` below is what the
 * email side takes, so the compiler refuses to let either of them reach an inbox.
 */
export const EmailPurposeSchema = z.enum(["INVITE", "RESET", "VERIFY", "EXPORT", "TWOFA_PENDING"]);
export type EmailPurposeName = z.infer<typeof EmailPurposeSchema>;

/** The purposes that really are sent by email. The other two are deliberately not among them. */
export type EmailedPurposeName = Exclude<EmailPurposeName, "EXPORT" | "TWOFA_PENDING">;

/**
 * The raw token out of a link, exactly as it was minted: 32 random bytes as lower-case hex. Parsing
 * it before it reaches the database means a query string full of anything else is refused as
 * "this link no longer works" — the same answer a wrong, expired or used link gets.
 */
export const EmailTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "That link no longer works.");
export type EmailTokenValue = z.infer<typeof EmailTokenSchema>;

/** Asking for a reset link. The answer is the same whatever address is typed in here. */
export const ForgotPasswordInput = z.object({ email: emailAddress });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

/** Spending a reset link: the token out of the address bar, and the new password. */
export const ResetPasswordInput = z.object({
  token: EmailTokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/** Spending an invitation link. The same two fields, deliberately a name of its own. */
export const SetPasswordInput = z.object({
  token: EmailTokenSchema,
  password: PasswordSchema,
});
export type SetPasswordInput = z.infer<typeof SetPasswordInput>;

/** Spending a verification link. */
export const VerifyEmailInput = z.object({ token: EmailTokenSchema });
export type VerifyEmailInput = z.infer<typeof VerifyEmailInput>;

/** Sending somebody's invitation again — the person, never the link. */
export const ResendInviteInput = z.object({ id: id });
export type ResendInviteInput = z.infer<typeof ResendInviteInput>;

/**
 * What the two public password pages hand back. Never the address, never a session — signing in is
 * a separate, deliberate step, so a reset link can never become a way in on its own.
 */
export const PasswordChangedDTO = z.object({ changed: z.literal(true) });
export type PasswordChangedDTO = z.infer<typeof PasswordChangedDTO>;

/** What the resend actions hand back: that we tried, and nothing about the link itself. */
export const EmailSentDTO = z.object({ sent: z.literal(true) });
export type EmailSentDTO = z.infer<typeof EmailSentDTO>;

/* ------------------------------------------------------------------ */
/* Two-factor sign-in                                                  */
/* ------------------------------------------------------------------ */

/**
 * The six digits an authenticator app shows. Spaces are stripped first, because people type them
 * the way the app displays them ("123 456") and being told off for that is no security at all.
 */
export const TotpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your app."));

/**
 * One of the eight codes somebody was given to keep. Hyphens, spaces and lower case are all
 * forgiven and the value is normalised to the exact form that was hashed when it was issued.
 */
export const RecoveryCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{10}$/, "Enter one of your recovery codes."));

/**
 * What somebody is shown while they are setting two-factor sign-in up: the QR code to point their
 * app at, the same key in letters for anyone who cannot scan it, and the address behind both.
 *
 * It is built fresh on every attempt and stored nowhere but the sealed column it came from — no
 * audit row and no log line has ever carried any of it.
 */
export const TwoFactorEnrollmentDTO = z.object({
  /** A PNG of the otpauth address, as a data: URI. Rendered on the server; no client JavaScript. */
  qrDataUri: z.string(),
  /** The same secret in base32, for typing in by hand. */
  manualKey: z.string(),
  otpauthUrl: z.string(),
});
export type TwoFactorEnrollmentDTO = z.infer<typeof TwoFactorEnrollmentDTO>;

/**
 * The recovery codes, in plain text. **This is the only time they are ever readable** — the
 * database holds nothing but their SHA-256 hashes, so a lost list is replaced rather than re-read.
 */
export const TwoFactorCodesDTO = z.object({
  codes: z.array(z.string()).min(1),
});
export type TwoFactorCodesDTO = z.infer<typeof TwoFactorCodesDTO>;

/** What the account page needs to draw the card. Never the secret, never a code. */
export const TwoFactorStatusDTO = z.object({
  enabled: z.boolean(),
  enabledAt: dateOut.nullable(),
  /** How many unused recovery codes are left. The screen warns at two or fewer. */
  recoveryCodesLeft: z.number().int().nonnegative(),
});
export type TwoFactorStatusDTO = z.infer<typeof TwoFactorStatusDTO>;

/** Finishing enrolment: the first working code out of the app, which is the proof it is set up. */
export const ConfirmTwoFactorInput = z.object({ code: TotpCodeSchema });
export type ConfirmTwoFactorInput = z.infer<typeof ConfirmTwoFactorInput>;

/**
 * Proof of the second factor, for switching it off or replacing the recovery codes: a live code
 * from the app **or** an unused recovery code, and exactly one of the two. A password alone is
 * never enough — somebody who has walked up to an unlocked laptop has the password.
 */
export const TwoFactorProofInput = z
  .object({
    code: TotpCodeSchema.optional(),
    recoveryCode: RecoveryCodeSchema.optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: "Enter a code from your app, or one of your recovery codes.",
  });
export type TwoFactorProofInput = z.infer<typeof TwoFactorProofInput>;

/**
 * The second half of signing in: the pending token the password step handed back, plus one of the
 * two kinds of proof. The token is the same 32-random-byte, hashed, single-use row an emailed link
 * uses, and it is never a session on its own.
 */
export const TwoFactorChallengeInput = z
  .object({
    pendingToken: EmailTokenSchema,
    code: TotpCodeSchema.optional(),
    recoveryCode: RecoveryCodeSchema.optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: "Enter a code from your app, or one of your recovery codes.",
  });
export type TwoFactorChallengeInput = z.infer<typeof TwoFactorChallengeInput>;

/**
 * What the sign-in route answers when the password was right and the account has two-factor on.
 * **There is no session and no cookie in this answer** — only a five-minute ticket to the second
 * step.
 */
export const TwoFactorChallengeDTO = z.object({
  status: z.literal("TWO_FACTOR_REQUIRED"),
  pendingToken: z.string(),
  expiresAt: dateOut,
});
export type TwoFactorChallengeDTO = z.infer<typeof TwoFactorChallengeDTO>;

/** An administrator turning somebody else's two-factor off, when the phone is gone for good. */
export const AdminResetTwoFactorInput = z.object({ id: id });
export type AdminResetTwoFactorInput = z.infer<typeof AdminResetTwoFactorInput>;

/* ------------------------------------------------------------------ */
/* Data rights: taking a copy of your data out                         */
/* ------------------------------------------------------------------ */

/**
 * Where a company's full export has got to. Everything here is derived at read time from the audit
 * trail and the file on disk — nothing about an export is stored in a column of its own.
 *
 * `downloadUrl` carries the raw download token, so this DTO is only ever answered to an
 * administrator of that company over an authenticated route, and it is never logged or audited.
 */
export const WorkspaceExportStatusSchema = z.enum(["NONE", "WORKING", "READY", "FAILED"]);
export type WorkspaceExportStatusName = z.infer<typeof WorkspaceExportStatusSchema>;

export const WorkspaceExportStatusDTO = z.object({
  state: WorkspaceExportStatusSchema,
  /** When the export now being described was asked for. */
  requestedAt: dateOut.nullable(),
  requestedByName: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  /** How many uploaded files went into the archive, and how many documents they belong to. */
  fileCount: z.number().int().nonnegative().nullable(),
  documentCount: z.number().int().nonnegative().nullable(),
  downloadUrl: z.string().nullable(),
  linkExpiresAt: dateOut.nullable(),
  /** True when a fresh export may be started right now. */
  canStart: z.boolean(),
  /** When the once-a-day window opens again, when it is closed. */
  nextAllowedAt: dateOut.nullable(),
  /** Plain English, only when the last attempt failed. */
  error: z.string().nullable(),
});
export type WorkspaceExportStatusDTO = z.infer<typeof WorkspaceExportStatusDTO>;

/**
 * One person's own copy of their own data. Everything in it is reachable through their ordinary
 * visibility — a contractor's copy is narrowed exactly as every other read of theirs is — and
 * nothing here is ever a password, a token or a hash of either.
 */
export const PersonalExportDTO = z.object({
  exportedAt: dateOut,
  workspaceName: z.string(),
  profile: z.object({
    name: z.string(),
    email: z.string(),
    role: RoleSchema,
    jobTitle: z.string().nullable(),
    companyName: z.string().nullable(),
    disciplineName: z.string().nullable(),
    accessEndsOn: dateOut.nullable(),
    emailConfirmedAt: dateOut.nullable(),
    lastSignedInAt: dateOut.nullable(),
    accountCreatedAt: dateOut,
  }),
  projects: z.array(
    z.object({
      projectName: z.string(),
      projectCode: z.string(),
      yourRole: RoleSchema,
      yourDiscipline: z.string().nullable(),
      joinedAt: dateOut,
    }),
  ),
  assignedTasks: z.array(
    z.object({
      title: z.string(),
      status: TaskStatusSchema,
      priority: PrioritySchema,
      deadline: dateOut,
      completedAt: dateOut.nullable(),
      mainTaskTitle: z.string(),
      projectName: z.string(),
      disciplineName: z.string(),
    }),
  ),
  comments: z.array(
    z.object({
      body: z.string(),
      onTask: z.string(),
      projectName: z.string(),
      createdAt: dateOut,
      editedAt: dateOut.nullable(),
      deletedAt: dateOut.nullable(),
    }),
  ),
  notifications: z.array(
    z.object({
      type: NotificationTypeSchema,
      title: z.string(),
      body: z.string(),
      createdAt: dateOut,
      readAt: dateOut.nullable(),
    }),
  ),
  favorites: z.array(z.object({ what: z.string(), title: z.string(), createdAt: dateOut })),
  personalList: z.array(
    z.object({
      title: z.string(),
      done: z.boolean(),
      createdAt: dateOut,
      completedAt: dateOut.nullable(),
    }),
  ),
  acknowledgedAnnouncements: z.array(z.object({ title: z.string(), createdAt: dateOut })),
  dismissedAnnouncements: z.array(z.object({ title: z.string(), createdAt: dateOut })),
  /** The sections that hit the per-section cap, named so nobody thinks they have the lot. */
  truncated: z.array(z.string()),
});
export type PersonalExportDTO = z.infer<typeof PersonalExportDTO>;

/* ------------------------------------------------------------------ */
/* Data rights: deleting an account, and deleting a workspace          */
/* ------------------------------------------------------------------ */

/**
 * The word somebody types to confirm they mean to delete their own account.
 *
 * One fixed string everybody can type correctly, rather than their own email address under stress
 * — and it is checked here as well as in the service, so a form that skipped the box is refused
 * before a single row is read.
 */
export const ACCOUNT_DELETE_CONFIRMATION = "DELETE";

export const DeleteMyAccountInput = z.object({
  // The `: boolean` is load-bearing. Without it TypeScript infers a type predicate from the
  // comparison and zod narrows the field's type to the literal "DELETE", which would then make
  // every caller cast whatever the person actually typed. The field is a string; only the value
  // that gets through is fixed.
  confirm: z.string().refine((value): boolean => value === ACCOUNT_DELETE_CONFIRMATION, {
    message: `Type ${ACCOUNT_DELETE_CONFIRMATION} to confirm.`,
  }),
});
export type DeleteMyAccountInput = z.infer<typeof DeleteMyAccountInput>;

/** What deleting your own account hands back. Never a name, never an address — both are gone. */
export const AccountDeletedDTO = z.object({ deleted: z.literal(true) });
export type AccountDeletedDTO = z.infer<typeof AccountDeletedDTO>;

/**
 * What the "delete my account" card needs before anybody presses anything: whether this person is
 * the only administrator left, so the screen can say so before they type the word rather than
 * after. The server refuses them either way — this is the hint, not the rule.
 */
export const AccountDeletionOptionsDTO = z.object({
  soleAdmin: z.boolean(),
});
export type AccountDeletionOptionsDTO = z.infer<typeof AccountDeletionOptionsDTO>;

/** Asking for the whole workspace to be deleted: the workspace's own name, typed out exactly. */
export const RequestWorkspaceDeletionInput = z.object({
  confirmName: z.string().trim().min(1, "Type your workspace's name to confirm."),
});
export type RequestWorkspaceDeletionInput = z.infer<typeof RequestWorkspaceDeletionInput>;

/**
 * Where a workspace's deletion has got to. Everything derived except the two stored columns:
 * `deletesOn` is the moment it was asked for plus the grace period and `daysLeft` counts from
 * today, both worked out at read time exactly as OVERDUE and a locked phase are.
 */
export const WorkspaceDeletionDTO = z.object({
  workspaceName: z.string(),
  pending: z.boolean(),
  requestedAt: dateOut.nullable(),
  requestedByName: z.string().nullable(),
  /** The day it becomes permanent. Null while nobody has asked. */
  deletesOn: dateOut.nullable(),
  /** Whole days left before that, never below zero. Null while nobody has asked. */
  daysLeft: z.number().int().nonnegative().nullable(),
});
export type WorkspaceDeletionDTO = z.infer<typeof WorkspaceDeletionDTO>;

/* ------------------------------------------------------------------ */
/* Plans and limits                                                    */
/* ------------------------------------------------------------------ */

/**
 * The three things a plan puts a ceiling on, counted right now. Every number here is COUNTED at
 * read time from the rows themselves — there is no usage column anywhere and there must not be one,
 * exactly as OVERDUE and a locked phase are derived.
 */
export const PlanUsageDTO = z.object({
  /** Live projects (a soft-deleted project frees its place). */
  projects: z.number().int().nonnegative(),
  /** People who can still sign in. A deactivated account does not count. */
  users: z.number().int().nonnegative(),
  /** Every stored revision's bytes, including the revisions of soft-deleted documents. */
  documentBytes: z.number().int().nonnegative(),
});
export type PlanUsageDTO = z.infer<typeof PlanUsageDTO>;

/** What this plan allows. `null` in any slot means unlimited. */
export const PlanLimitsDTO = z.object({
  projects: z.number().int().positive().nullable(),
  users: z.number().int().positive().nullable(),
  documentBytes: z.number().int().positive().nullable(),
});
export type PlanLimitsDTO = z.infer<typeof PlanLimitsDTO>;

/**
 * What the Billing page is told about the payment provider — CONFIGURATION, never money. There is
 * no price, no balance, no card and no invoice here, and there never will be: those live at the
 * provider, and "Manage billing" is how somebody goes and looks at them.
 *
 * Everything here is either an environment fact or derived at read time from rows this app already
 * has. Nothing new is stored to produce it.
 */
export const BillingProviderDTO = z.object({
  /** All four provider variables are set on this deployment, so upgrading is switched on. */
  configured: z.boolean(),
  /** We hold a subscription id for this company, so "Manage billing" has somewhere to go. */
  hasSubscription: z.boolean(),
  /**
   * The most recent payment signal we were sent about this company was a failure. Derived from the
   * recorded webhooks and only ever as good as the last one that arrived — the screen says so in
   * plain English rather than pretending to know more.
   */
  paymentIssue: z.boolean(),
});
export type BillingProviderDTO = z.infer<typeof BillingProviderDTO>;

/**
 * Where an administrator is being sent — a checkout or a customer-portal address, minted for one
 * press and handed straight to them. It is never stored, never logged and never audited.
 */
export const BillingRedirectDTO = z.object({ url: z.string().url() });
export type BillingRedirectDTO = z.infer<typeof BillingRedirectDTO>;

/**
 * What the Billing page shows. Plan, what this company is actually using, what its plan allows, and
 * whether a payment provider is switched on at all.
 */
export const BillingStatusDTO = z.object({
  plan: PlanSchema,
  usage: PlanUsageDTO,
  limits: PlanLimitsDTO,
  provider: BillingProviderDTO,
});
export type BillingStatusDTO = z.infer<typeof BillingStatusDTO>;
