// The UI's single doorway to the server actions listed in docs/CONVENTIONS.md.
// Screens import from here so the action modules are referenced in exactly one place.

export {
  createProject,
  updateProject,
  setExternalSignoffRequired,
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

// Transactional email, the signed-in half: sending an invitation or a verification link again.
export { resendInvite, resendVerificationEmail } from "@/server/actions/account";

// Admin → Integrations. No action here ever returns a saved webhook address.
export {
  saveIntegration,
  setIntegrationEnabled,
  setEventToggles,
  sendTestMessage,
  deleteIntegration,
  disconnectMicrosoft,
} from "@/server/actions/integrations";

// Admin → Data & privacy. The download link itself never comes back through an action.
export { startWorkspaceExport } from "@/server/actions/exports";

// Admin → Billing. Both hand back one address to navigate to, minted for that press alone.
export { openBillingPortal, startUpgrade } from "@/server/actions/billing";

// The deleting half: your own account, and the whole workspace's seven-day countdown.
export {
  cancelWorkspaceDeletion,
  deleteMyAccount,
  requestWorkspaceDeletion,
} from "@/server/actions/deletion";

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
  confirmDisciplineTaskReview,
  rejectDisciplineTaskReview,
} from "@/server/actions/discipline-tasks";

// The noticeboard: announcements, the department board, and the company setting behind them.
export {
  createPost,
  replyToPost,
  editPost,
  deletePost,
  dismissAnnouncement,
  acknowledgePost,
  setBroadcastPolicy,
} from "@/server/actions/posts";

// The sidebar's personal corner: starred shortcuts and a private to-do list. Neither is audited.
export { toggleFavorite } from "@/server/actions/favorites";

export {
  createPersonalTask,
  togglePersonalTask,
  deletePersonalTask,
} from "@/server/actions/personal-tasks";

// Two-factor sign-in. The QR code and the manual key come back once, from the first of these; the
// recovery codes come back once, from the second or the fourth. Nothing here ever returns a secret.
export {
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  regenerateRecoveryCodes,
  adminResetTwoFactor,
} from "@/server/actions/two-factor";
