// The timeline: a task tree on the left, a drawn schedule on the right. No chart library —
// plain SVG, so the bars behave exactly the way this app needs them to.
//
// Editing: drag a bar to move both dates, drag its right edge to move the deadline, or use the
// row's "Edit dates" button. Arrow keys nudge a focused bar by a day, Enter opens the editor.
// A held arrow key gathers its days up locally, exactly as a drag does, and saves once when the
// key comes up — one intended move is one save and one audit row, never thirty.
// The server decides whether a change is allowed; when it refuses, the bar goes back where it was
// and the refusal is shown in its own words.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { updateTaskDates } from "@/components/actions";
import { formatDate, formatShortDate, toDateInputValue } from "@/components/format";
import {
  DAY_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  addDays,
  columnsFor,
  daysBetween,
  rangeFor,
  todayUtc,
  weekendDays,
  xFor,
  type Zoom,
} from "@/components/gantt/timeline-math";
import { isLeadOrAboveOn, isManagerOn, type MeDTO } from "@/components/hooks/use-api";
import {
  Button,
  DateInput,
  DisciplineDot,
  Field,
  Modal,
  StatusBadge,
  statusColor,
  useToast,
} from "@/components/ui";
import type { GanttDTO, ProjectDTO, TaskStatusName } from "@/lib/zod-schemas";

const TREE_WIDTH = 320;
const BAR_HEIGHT = 16;
const BAR_TOP = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const HANDLE_WIDTH = 8;

type Row = {
  key: string;
  id: string;
  kind: "MAIN" | "DISCIPLINE";
  title: string;
  startDate: Date | null;
  deadline: Date;
  status: TaskStatusName;
  progressPct: number | null;
  colorHex: string | null;
  disciplineCode: string | null;
  assigneeName: string | null;
  depth: number;
  editable: boolean;
  href: string;
  mainTaskId: string;
};

type Drag = { rowKey: string; mode: "move" | "resize"; startX: number; days: number };

/** How long after the last arrow key we wait before saving, in case the key is still held down. */
const NUDGE_SAVE_DELAY = 400;

/** Moves one task's dates inside a cached schedule, so the bar jumps before the server answers. */
function patchDates(
  current: GanttDTO | undefined,
  row: Row,
  startDate: Date | null,
  deadline: Date,
): GanttDTO | undefined {
  if (!current) return current;
  return {
    mainTasks: current.mainTasks.map((task) => {
      if (row.kind === "MAIN" && task.id === row.id) return { ...task, startDate, deadline };
      return {
        ...task,
        disciplineTasks: task.disciplineTasks.map((subtask) =>
          row.kind === "DISCIPLINE" && subtask.id === row.id
            ? { ...subtask, startDate, deadline }
            : subtask,
        ),
      };
    }),
  };
}

export function GanttChart({
  gantt,
  project,
  me,
  queryKey,
}: {
  gantt: GanttDTO;
  project: ProjectDTO | undefined;
  me: MeDTO | undefined;
  /** The query key holding this schedule — it is patched first and refreshed after. */
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>("weeks");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  /** Arrow-key days gathered but not saved yet — drawn on the bar, sent once at the end. */
  const [nudge, setNudge] = useState<{ rowKey: string; days: number } | null>(null);
  const pendingNudge = useRef<{ row: Row; days: number } | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dayWidth = DAY_WIDTH[zoom];
  const range = useMemo(() => rangeFor(gantt, zoom), [gantt, zoom]);
  const columns = useMemo(() => columnsFor(range, zoom), [range, zoom]);
  const weekends = useMemo(() => (zoom === "weeks" ? weekendDays(range) : []), [range, zoom]);
  const width = range.days * dayWidth;
  const today = todayUtc();

  const disciplineIdFor = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const discipline of project?.disciplines ?? []) byCode.set(discipline.code, discipline.disciplineId);
    return byCode;
  }, [project]);

  const rows = useMemo<Row[]>(() => {
    const canEditMain = isManagerOn(me, project);
    const out: Row[] = [];
    for (const task of gantt.mainTasks) {
      out.push({
        key: `main-${task.id}`,
        id: task.id,
        kind: "MAIN",
        title: task.title,
        startDate: task.startDate,
        deadline: task.deadline,
        status: task.status,
        progressPct: task.progressPct,
        colorHex: null,
        disciplineCode: null,
        assigneeName: null,
        depth: 0,
        editable: canEditMain,
        href: `/tasks/${task.id}`,
        mainTaskId: task.id,
      });
      if (collapsed.has(task.id)) continue;
      for (const subtask of task.disciplineTasks) {
        out.push({
          key: `discipline-${subtask.id}`,
          id: subtask.id,
          kind: "DISCIPLINE",
          title: subtask.title,
          startDate: subtask.startDate,
          deadline: subtask.deadline,
          status: subtask.status,
          progressPct: null,
          colorHex: subtask.disciplineColorHex,
          disciplineCode: subtask.disciplineCode,
          assigneeName: subtask.assigneeName,
          depth: 1,
          editable: isLeadOrAboveOn(me, project, disciplineIdFor.get(subtask.disciplineCode)),
          href: `/discipline-tasks/${subtask.id}`,
          mainTaskId: task.id,
        });
      }
    }
    return out;
  }, [gantt, collapsed, me, project, disciplineIdFor]);

  /** The dates a row is drawn with right now — the dragged or nudged row moves before it saves. */
  function shownDates(row: Row): { startDate: Date | null; deadline: Date } {
    if (nudge && nudge.rowKey === row.key && nudge.days !== 0) {
      return {
        startDate: row.startDate ? addDays(row.startDate, nudge.days) : null,
        deadline: addDays(row.deadline, nudge.days),
      };
    }
    if (!drag || drag.rowKey !== row.key || drag.days === 0) {
      return { startDate: row.startDate, deadline: row.deadline };
    }
    if (drag.mode === "move") {
      return {
        startDate: row.startDate ? addDays(row.startDate, drag.days) : null,
        deadline: addDays(row.deadline, drag.days),
      };
    }
    const earliest = row.startDate ?? row.deadline;
    const moved = addDays(row.deadline, drag.days);
    return { startDate: row.startDate, deadline: moved < earliest ? earliest : moved };
  }

  async function save(row: Row, startDate: Date | null, deadline: Date) {
    const previous = queryClient.getQueryData<GanttDTO>(queryKey);
    queryClient.setQueryData<GanttDTO>(queryKey, (current) =>
      patchDates(current, row, startDate, deadline),
    );
    setSaving(true);

    try {
      const result = await updateTaskDates({
        id: row.id,
        kind: row.kind,
        startDate,
        deadline,
      });

      if (!result.ok) {
        // Put the bar back and repeat the server's refusal exactly as it wrote it. The snapshot we
        // put back may itself be out of date, so ask the server for the real schedule as well.
        queryClient.setQueryData<GanttDTO>(queryKey, previous);
        void queryClient.invalidateQueries({ queryKey });
        show(result.error, "error");
        return;
      }

      show(
        startDate
          ? `Moved “${row.title}” to ${formatShortDate(startDate)}–${formatShortDate(deadline)}.`
          : `Changed “${row.title}” deadline to ${formatShortDate(deadline)}.`,
        "success",
      );
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["task", row.mainTaskId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (project) void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      if (row.kind === "DISCIPLINE") {
        void queryClient.invalidateQueries({ queryKey: ["discipline-task", row.id] });
      }
    } catch {
      queryClient.setQueryData<GanttDTO>(queryKey, previous);
      void queryClient.invalidateQueries({ queryKey });
      show("Couldn't save the new dates. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  // While a bar is being dragged the pointer belongs to the window, not to the bar.
  useEffect(() => {
    if (!drag) return;
    const dragging = drag;
    const active = rows.find((row) => row.key === dragging.rowKey);

    function onMove(event: PointerEvent) {
      const days = Math.round((event.clientX - dragging.startX) / dayWidth);
      setDrag((current) => (current && current.days !== days ? { ...current, days } : current));
    }

    function onUp() {
      setDrag(null);
      if (!active || dragging.days === 0) return;
      if (dragging.mode === "move") {
        void save(
          active,
          active.startDate ? addDays(active.startDate, dragging.days) : null,
          addDays(active.deadline, dragging.days),
        );
        return;
      }
      const earliest = active.startDate ?? active.deadline;
      const moved = addDays(active.deadline, dragging.days);
      void save(active, active.startDate, moved < earliest ? earliest : moved);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // save/rows are stable enough for one drag; re-subscribing on every render would drop the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, dayWidth]);

  function scrollToToday() {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, xFor(today, range, zoom) - element.clientWidth / 2);
  }

  // Open on today's date rather than on the very start of the project.
  useEffect(() => {
    scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, zoom]);

  /** Sends whatever the arrow keys have gathered so far, as one move. */
  function commitNudge() {
    if (nudgeTimer.current) {
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
    }
    const pending = pendingNudge.current;
    pendingNudge.current = null;
    setNudge(null);
    if (!pending || pending.days === 0) return;
    void save(
      pending.row,
      pending.row.startDate ? addDays(pending.row.startDate, pending.days) : null,
      addDays(pending.row.deadline, pending.days),
    );
  }

  /**
   * One arrow key press. A held key repeats about thirty times a second, so the days are added up
   * here and only sent when the key comes up — or shortly after the last repeat.
   */
  function nudgeBy(row: Row, days: number) {
    // The keyboard moved to a different bar: finish the one that was being moved first.
    if (pendingNudge.current && pendingNudge.current.row.key !== row.key) commitNudge();

    const total = (pendingNudge.current?.days ?? 0) + days;
    pendingNudge.current = { row, days: total };
    setNudge({ rowKey: row.key, days: total });

    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(commitNudge, NUDGE_SAVE_DELAY);
  }

  // A pending nudge must never outlive the chart.
  useEffect(() => {
    return () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    };
  }, []);

  const height = rows.length * ROW_HEIGHT;
  const allCollapsed = collapsed.size === gantt.mainTasks.length && gantt.mainTasks.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
          {(["weeks", "months"] as Zoom[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setZoom(option)}
              aria-pressed={zoom === option}
              className={`px-3 py-1.5 text-xs font-semibold ${
                zoom === option
                  ? "bg-[var(--brand-primary)] text-white"
                  : "bg-white text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
              }`}
            >
              {option === "weeks" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={scrollToToday}>
          Today
        </Button>
        <button
          type="button"
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(gantt.mainTasks.map((task) => task.id)))
          }
          className="text-xs font-semibold text-[var(--brand-primary)] underline underline-offset-2"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
        {saving ? <span className="text-xs text-[var(--brand-gray)]">Saving…</span> : null}
      </div>

      <p className="text-xs text-[var(--brand-gray)] sm:hidden">
        The schedule view works best on a larger screen. Use a tablet or desktop for the full
        timeline.
      </p>

      <div className="hidden overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white sm:flex">
        {/* Left pane: the task tree. */}
        <div className="shrink-0 border-r border-[var(--border)]" style={{ width: TREE_WIDTH }}>
          <div
            className="flex items-center border-b border-[var(--border)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]"
            style={{ height: HEADER_HEIGHT }}
          >
            Task
          </div>
          {rows.map((row) => {
            const dates = shownDates(row);
            return (
              <div
                key={row.key}
                className="flex items-center gap-2 border-b border-[var(--border)] px-2 text-xs"
                style={{ height: ROW_HEIGHT }}
              >
                {row.kind === "MAIN" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })
                    }
                    aria-label={collapsed.has(row.id) ? `Show ${row.title}'s disciplines` : `Hide ${row.title}'s disciplines`}
                    aria-expanded={!collapsed.has(row.id)}
                    className="shrink-0 rounded px-1 text-[var(--brand-gray)] hover:text-[var(--brand-ink)]"
                  >
                    {collapsed.has(row.id) ? "▸" : "▾"}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}

                {row.colorHex && row.disciplineCode ? (
                  <DisciplineDot colorHex={row.colorHex} code={row.disciplineCode} />
                ) : (
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: statusColor(row.status) }}
                    aria-hidden="true"
                  />
                )}

                <Link
                  href={row.href}
                  className={`min-w-0 flex-1 truncate hover:underline ${
                    row.depth === 0
                      ? "font-semibold text-[var(--brand-ink)]"
                      : "text-[var(--brand-text)]"
                  }`}
                  title={row.title}
                >
                  {row.title}
                </Link>

                <span className="shrink-0 text-[10px] text-[var(--brand-gray)]">
                  {dates.startDate ? `${formatShortDate(dates.startDate)}–` : ""}
                  {formatShortDate(dates.deadline)}
                </span>

                {row.editable ? (
                  <button
                    type="button"
                    onClick={() => setEditing(row)}
                    className="shrink-0 rounded px-1 text-[10px] font-semibold text-[var(--brand-primary)] hover:underline"
                  >
                    Edit dates
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Right pane: the drawn timeline. */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <svg width={width} height={HEADER_HEIGHT} role="presentation">
            {columns.map((column) => (
              <g key={column.key}>
                <rect
                  x={column.x}
                  y={0}
                  width={column.width}
                  height={HEADER_HEIGHT}
                  fill="var(--surface)"
                />
                <line
                  x1={column.x}
                  y1={0}
                  x2={column.x}
                  y2={HEADER_HEIGHT}
                  stroke="var(--border)"
                />
                <text
                  x={column.x + 6}
                  y={HEADER_HEIGHT / 2 + 4}
                  fontSize={10}
                  fill="var(--brand-gray)"
                >
                  {column.label}
                </text>
              </g>
            ))}
            <line
              x1={0}
              y1={HEADER_HEIGHT - 0.5}
              x2={width}
              y2={HEADER_HEIGHT - 0.5}
              stroke="var(--border)"
            />
          </svg>

          <svg width={width} height={height} aria-label="Task schedule">
            {weekends.map((day) => (
              <rect
                key={`weekend-${day}`}
                x={day * dayWidth}
                y={0}
                width={dayWidth}
                height={height}
                fill="var(--page-bg)"
              />
            ))}

            {columns.map((column) => (
              <line
                key={`grid-${column.key}`}
                x1={column.x}
                y1={0}
                x2={column.x}
                y2={height}
                stroke="var(--border)"
              />
            ))}

            {rows.map((row, index) => (
              <line
                key={`row-${row.key}`}
                x1={0}
                y1={(index + 1) * ROW_HEIGHT - 0.5}
                x2={width}
                y2={(index + 1) * ROW_HEIGHT - 0.5}
                stroke="var(--border)"
              />
            ))}

            {/* Today. */}
            <line
              x1={xFor(today, range, zoom) + dayWidth / 2}
              y1={0}
              x2={xFor(today, range, zoom) + dayWidth / 2}
              y2={height}
              stroke="var(--status-blocked)"
              strokeWidth={1.5}
            />

            {rows.map((row, index) => {
              const dates = shownDates(row);
              const y = index * ROW_HEIGHT + BAR_TOP;
              const label = `${row.title}, ${
                dates.startDate ? `${formatDate(dates.startDate)} to ` : "due "
              }${formatDate(dates.deadline)}${row.editable ? ". Arrow keys move it by a day, Enter edits the dates." : ""}`;

              const common = {
                tabIndex: 0,
                role: "button" as const,
                "aria-label": label,
                onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
                  if (!row.editable) return;
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    nudgeBy(row, 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    nudgeBy(row, -1);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    commitNudge();
                    setEditing(row);
                  }
                },
                onKeyUp: (event: React.KeyboardEvent<SVGGElement>) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") commitNudge();
                },
                // Tabbing or clicking away also finishes the move rather than losing it.
                onBlur: () => commitNudge(),
                onPointerDown: (event: React.PointerEvent<SVGGElement>) => {
                  if (!row.editable || event.button !== 0) return;
                  event.preventDefault();
                  setDrag({ rowKey: row.key, mode: "move", startX: event.clientX, days: 0 });
                },
                style: { cursor: row.editable ? "grab" : "not-allowed" },
              };

              // A task with no start date is a single moment: draw it as a diamond on its deadline.
              if (!dates.startDate) {
                const centre = xFor(dates.deadline, range, zoom) + dayWidth / 2;
                const size = BAR_HEIGHT / 2;
                return (
                  <g key={row.key} {...common}>
                    <polygon
                      points={`${centre},${y} ${centre + size},${y + size} ${centre},${y + BAR_HEIGHT} ${centre - size},${y + size}`}
                      fill={row.colorHex ?? statusColor(row.status)}
                    />
                    <title>{label}</title>
                  </g>
                );
              }

              const x = xFor(dates.startDate, range, zoom);
              const barWidth = Math.max(
                dayWidth,
                (daysBetween(dates.startDate, dates.deadline) + 1) * dayWidth,
              );

              return (
                <g key={row.key} {...common}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={BAR_HEIGHT}
                    rx={3}
                    fill={statusColor(row.status)}
                  />
                  {row.progressPct !== null && row.progressPct > 0 ? (
                    <rect
                      x={x}
                      y={y}
                      width={(barWidth * Math.min(100, row.progressPct)) / 100}
                      height={BAR_HEIGHT}
                      rx={3}
                      fill="var(--brand-accent)"
                      opacity={0.65}
                    />
                  ) : null}
                  {row.editable ? (
                    <rect
                      x={x + barWidth - HANDLE_WIDTH}
                      y={y}
                      width={HANDLE_WIDTH}
                      height={BAR_HEIGHT}
                      fill="var(--brand-ink)"
                      opacity={0.35}
                      style={{ cursor: "ew-resize" }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDrag({
                          rowKey: row.key,
                          mode: "resize",
                          startX: event.clientX,
                          days: 0,
                        });
                      }}
                    />
                  ) : null}
                  <title>{label}</title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {editing ? (
        <EditDatesDialog
          row={editing}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(startDate, deadline) => {
            const row = editing;
            setEditing(null);
            void save(row, startDate, deadline);
          }}
        />
      ) : null}
    </div>
  );
}

/** The typed way to change a bar's dates, for anyone who would rather not drag. */
function EditDatesDialog({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: Row;
  saving: boolean;
  onClose: () => void;
  onSave: (startDate: Date | null, deadline: Date) => void;
}) {
  const [startDate, setStartDate] = useState(toDateInputValue(row.startDate));
  const [deadline, setDeadline] = useState(toDateInputValue(row.deadline));

  const orderError =
    startDate && deadline && deadline < startDate
      ? "Deadline can't be before the start date."
      : undefined;

  return (
    <Modal
      open
      size="sm"
      title="Edit dates"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={!deadline || Boolean(orderError)}
            onClick={() => onSave(startDate ? new Date(startDate) : null, new Date(deadline))}
          >
            Save dates
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm">
          <StatusBadge status={row.status} />
          <span className="font-semibold text-[var(--brand-ink)]">{row.title}</span>
        </p>
        <Field label="Start date" hint="Leave empty to show this task as a single milestone.">
          <DateInput value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </Field>
        <Field label="Deadline" error={orderError}>
          <DateInput
            value={deadline}
            min={startDate || undefined}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
