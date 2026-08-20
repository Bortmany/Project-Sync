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
  lastLoginAt: dateOut.nullable(),
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
/* Main tasks                                                          */
/* ------------------------------------------------------------------ */

const DisciplineSummaryItem = z.object({
  disciplineId: id,
  code: z.string(),
  colorHex: z.string(),
  status: TaskStatusSchema,
});

export const MainTaskDTO = z.object({
  id: id,
  projectId: id,
  projectCode: z.string(),
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
});
export type CreateDisciplineTaskInput = z.infer<typeof CreateDisciplineTaskInput>;

export const AddDependencyInput = z.object({
  predecessorId: id,
  successorId: id,
});
export type AddDependencyInput = z.infer<typeof AddDependencyInput>;

export const UpdateTaskDatesInput = z.object({
  id: id,
  kind: z.enum(["MAIN", "DISCIPLINE"]),
  startDate: dateIn.nullable().optional(),
  deadline: dateIn,
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
