// Status and progress indicators: StatusBadge, PriorityFlag, DisciplineDot, ProgressBar, StatTile, Avatar.

import type { PriorityName, TaskStatusName } from "@/lib/zod-schemas";

const STATUS_LABEL: Record<TaskStatusName, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  AWAITING_REVIEW: "Awaiting review",
  COMPLETED: "Completed",
};

const STATUS_STYLE: Record<TaskStatusName, { background: string; color: string }> = {
  NOT_STARTED: { background: "var(--status-not-started)", color: "#ffffff" },
  IN_PROGRESS: { background: "var(--status-in-progress)", color: "#ffffff" },
  BLOCKED: { background: "var(--status-blocked)", color: "#ffffff" },
  AWAITING_REVIEW: { background: "var(--status-awaiting-review)", color: "var(--olng-navy)" },
  COMPLETED: { background: "var(--status-completed)", color: "#ffffff" },
};

export function statusLabel(status: TaskStatusName): string {
  return STATUS_LABEL[status];
}

/** The fill a status is drawn with — the same colour StatusBadge uses, for timeline bars and dots. */
export function statusColor(status: TaskStatusName): string {
  return STATUS_STYLE[status].background;
}

export function StatusBadge({
  status,
  overridden = false,
}: {
  status: TaskStatusName;
  overridden?: boolean;
}) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: style.background, color: style.color }}
    >
      {STATUS_LABEL[status]}
      {overridden ? <span title="Status set by hand with a recorded reason">*</span> : null}
    </span>
  );
}

const PRIORITY_LABEL: Record<PriorityName, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

const PRIORITY_COLOR: Record<PriorityName, string> = {
  LOW: "var(--olng-gray)",
  MEDIUM: "var(--olng-sail)",
  HIGH: "var(--olng-blue)",
  CRITICAL: "var(--status-blocked)",
};

export function PriorityFlag({ priority }: { priority: PriorityName }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--olng-text)]">
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
        <path d="M1 0v12" stroke={PRIORITY_COLOR[priority]} strokeWidth="1.5" />
        <path d="M1.5 1h7l-2 2.5 2 2.5h-7z" fill={PRIORITY_COLOR[priority]} />
      </svg>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function DisciplineDot({
  colorHex,
  code,
  showCode = false,
}: {
  colorHex: string;
  code: string;
  showCode?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--olng-text)]">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: colorHex }}
        aria-hidden="true"
      />
      <span className={showCode ? "" : "sr-only"}>{code}</span>
    </span>
  );
}

export function ProgressBar({
  pct,
  completed,
  total,
  showCount = false,
}: {
  pct: number;
  completed?: number;
  total?: number;
  showCount?: boolean;
}) {
  const safe = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span className="inline-flex w-full items-center gap-2">
      <span
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--olng-gray)]/40"
        role="progressbar"
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="block h-full rounded-full bg-[var(--olng-sail)]"
          style={{ width: `${safe}%` }}
        />
      </span>
      {showCount && typeof completed === "number" && typeof total === "number" ? (
        <span className="text-xs tabular-nums text-[var(--olng-text)]">
          {completed}/{total}
        </span>
      ) : (
        <span className="text-xs tabular-nums text-[var(--olng-text)]">{safe}%</span>
      )}
    </span>
  );
}

export function StatTile({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-3">
      <div
        className="text-2xl font-semibold tabular-nums"
        style={{ color: alert ? "var(--status-blocked)" : "var(--olng-navy)" }}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--olng-text)]">{label}</div>
    </div>
  );
}

/** Turns "Aisha Al Hinai" into "AA". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--olng-navy)] font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      title={name}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
