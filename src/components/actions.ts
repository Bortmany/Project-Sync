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
  updateTaskDates,
} from "@/server/actions/main-tasks";

// The stage gates: phases, their order, and the recorded override that opens a locked one.
export {
  createPhase,
  renamePhase,
  reorderPhases,
  deletePhase,
  overridePhaseLock,
  setMainTaskPhase,
} from "@/server/actions/phases";

export {
  createUser,
  updateUser,
  deactivateUser,
  createDiscipline,
  updateDiscipline,
} from "@/server/actions/admin";

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

// The sidebar's personal corner: starred shortcuts and a private to-do list. Neither is audited.
export { toggleFavorite } from "@/server/actions/favorites";

export {
  createPersonalTask,
  togglePersonalTask,
  deletePersonalTask,
} from "@/server/actions/personal-tasks";
