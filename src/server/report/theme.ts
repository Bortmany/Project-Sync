// The report's palette. The PDF and PowerPoint libraries cannot read CSS variables, so the exact
// values of the brand tokens in `src/app/globals.css` are copied here ONCE. No new colour: if a
// token changes there, change it here in the same edit.

export const COLOR = {
  ink: "#152647", // --brand-ink
  primary: "#2e5aac", // --brand-primary
  mid: "#1f3d77", // --brand-mid
  accent: "#46c4b0", // --brand-accent
  text: "#4a4e57", // --brand-text
  gray: "#a9aeb8", // --brand-gray: lines and disabled looks only, never text
  stone: "#d8d2c4", // --brand-stone
  pageBg: "#f5f6f7", // --page-bg
  border: "#e3e5e6", // --border
  white: "#ffffff",
  blocked: "#b54a4a", // --status-blocked, the only red
  completed: "#3e7a5e", // --status-completed
} as const;

export type ReportStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "AWAITING_REVIEW" | "COMPLETED";

/** Status colours as on screen: --status-not-started is --brand-gray, in-progress is --brand-primary. */
export const STATUS_COLOR: Record<ReportStatus, string> = {
  NOT_STARTED: COLOR.gray,
  IN_PROGRESS: COLOR.primary,
  BLOCKED: COLOR.blocked,
  AWAITING_REVIEW: COLOR.stone,
  COMPLETED: COLOR.completed,
};

export const STATUS_LABEL: Record<ReportStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  AWAITING_REVIEW: "Awaiting review",
  COMPLETED: "Completed",
};

export const STATUS_ORDER: ReportStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "AWAITING_REVIEW",
  "COMPLETED",
];
