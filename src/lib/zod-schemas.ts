// THE CONTRACT FILE: every input and every DTO the app uses. Later milestones import these names — never redefine them.

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const RoleSchema = z.enum(["ADMIN", "PROJECT_MANAGER", "DISCIPLINE_LEAD", "ENGINEER"]);
export type RoleName = z.infer<typeof RoleSchema>;

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
  password: z
    .string()
    .min(12, "Use at least 12 characters — a short sentence works well.")
    .max(200),
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
  isActive: z.boolean(),
  // Only the admin user screens need sign-in history; the pickers must not carry it.
  lastLoginAt: dateOut.nullable().optional(),
  createdAt: dateOut,
});
export type UserDTO = z.infer<typeof UserDTO>;

export const CreateUserInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: shortText,
  password: z.string().min(12).max(200),
  role: RoleSchema,
  disciplineId: id.nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const UpdateUserInput = z.object({
  id: id,
  name: shortText.optional(),
  role: RoleSchema.optional(),
  disciplineId: id.nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12).max(200).optional(),
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

export const CommentDTO = z.object({
  id: id,
  body: z.string(),
  authorId: id,
  authorName: z.string(),
  mainTaskId: z.string().nullable(),
  disciplineTaskId: z.string().nullable(),
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
    mentions: z.array(id).max(50).default([]),
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
/* Chat integrations (Slack and Microsoft Teams)                       */
/* ------------------------------------------------------------------ */

/**
 * Which chat tool a webhook belongs to. A zod enum over a plain string column, NOT a database
 * enum: adding a third tool later needs no migration.
 */
export const IntegrationKindSchema = z.enum(["SLACK", "TEAMS"]);
export type IntegrationKindName = z.infer<typeof IntegrationKindSchema>;

/** The events an organisation can switch on or off for a chat channel. */
export const IntegrationEventSchema = z.enum([
  "taskAssigned",
  "mention",
  "statusChange",
  "overdueReminder",
  "gateOverride",
]);
export type IntegrationEventName = z.infer<typeof IntegrationEventSchema>;

/** Every event, on or off. All five are always present, so a saved map is never half-defined. */
export const IntegrationEventToggles = z.object({
  taskAssigned: z.boolean(),
  mention: z.boolean(),
  statusChange: z.boolean(),
  overdueReminder: z.boolean(),
  gateOverride: z.boolean(),
});
export type IntegrationEventToggles = z.infer<typeof IntegrationEventToggles>;

/** What a brand-new integration starts with: everything on, but the channel itself still disabled. */
export const DEFAULT_EVENT_TOGGLES: IntegrationEventToggles = {
  taskAssigned: true,
  mention: true,
  statusChange: true,
  overdueReminder: true,
  gateOverride: true,
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
