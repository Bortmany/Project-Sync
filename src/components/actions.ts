// The UI's single doorway to the server actions listed in docs/CONVENTIONS.md.
// Screens import from here so the action modules are referenced in exactly one place.

export {
  createProject,
  updateProject,
  upsertMember,
  removeMember,
  upsertProjectDiscipline,
  removeProjectDiscipline,
} from "@/server/actions/projects";

export {
  createMainTask,
  updateMainTask,
  overrideMainTaskStatus,
  clearOverride,
} from "@/server/actions/main-tasks";

export { createComment, editComment, deleteComment } from "@/server/actions/comments";

export {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/server/actions/notifications";

// Whole documents only — a revision is never deleted anywhere in this app.
export { softDeleteDocument } from "@/server/actions/documents";

export {
  createDisciplineTask,
  updateDisciplineTask,
  updateDisciplineTaskStatus,
  completeDisciplineTask,
  reopenDisciplineTask,
} from "@/server/actions/discipline-tasks";
