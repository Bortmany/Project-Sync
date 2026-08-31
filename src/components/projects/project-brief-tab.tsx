// "Where we stand": one project in three answers — how far it has come this week, what is holding
// it up right now, and what has to happen for the next gate to open.
//
// Everything on this tab is computed on the server from work the app already records. Locked phases
// and overdue counts are derived at read time, exactly as they are everywhere else.

"use client";

import Link from "next/link";
import { useProjectBrief } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import { DisciplineDot, ErrorBanner, SkeletonRows } from "@/components/ui";
import type { BriefItemDTO, ProjectBriefDTO, ProjectDTO } from "@/lib/zod-schemas";

function TaskLine({ item }: { item: BriefItemDTO }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--border)] py-1.5 last:border-b-0">
      <Link href={item.linkUrl} className="font-semibold text-[var(--brand-primary)] hover:underline">
        {item.title}
      </Link>
      {item.deadline ? (
        <span
          className="text-xs"
          style={{ color: item.daysOverdue ? "var(--status-blocked)" : "var(--brand-text)" }}
        >
          {formatDate(item.deadline)}
        </span>
      ) : null}
      {item.daysOverdue ? (
        <span className="text-xs font-semibold text-[var(--status-blocked)]">
          {item.daysOverdue === 1 ? "1 day over" : `${item.daysOverdue} days over`}
        </span>
      ) : null}
      {item.note ? <span className="text-xs text-[var(--brand-gray)]">{item.note}</span> : null}
    </li>
  );
}

/**
 * The one line under the bar, in plain English and honest about its own basis.
 *
 * Three things it must never say: "Up -4 points" when a project went backwards; a percentage
 * compared against a total that has since changed; and "2 finished" when work was reopened and
 * finished again. The server hands over the seven-day-ago total for exactly that reason.
 */
function progressLine(progress: ProjectBriefDTO["progress"]): string {
  const day = formatDate(progress.since);
  if (progress.totalThen === 0) {
    return `Every main task on this project was added since ${day}, so there is nothing to compare with yet.`;
  }

  const moved = progress.pct - progress.pctThen;
  const finished = progress.completed - progress.completedThen;
  const basis = `${progress.completedThen} of the ${progress.totalThen} main task${
    progress.totalThen === 1 ? "" : "s"
  } that existed on ${day} ${progress.completedThen === 1 ? "was" : "were"} complete then (${progress.pctThen}%).`;

  const movement =
    moved > 0
      ? `Up ${moved} point${moved === 1 ? "" : "s"} since ${day}.`
      : moved < 0
        ? `Down ${Math.abs(moved)} point${Math.abs(moved) === 1 ? "" : "s"} since ${day} — work was reopened or added.`
        : `Unchanged since ${day}.`;

  const finishedWords =
    finished > 0
      ? ` ${finished} main task${finished === 1 ? "" : "s"} finished in those seven days.`
      : finished < 0
        ? ` ${Math.abs(finished)} went back to open in those seven days.`
        : " Nothing new finished in those seven days.";

  return `${movement}${finishedWords} ${basis}`;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ProjectBriefTab({ project }: { project: ProjectDTO }) {
  const brief = useProjectBrief(project.id);

  if (brief.isError) {
    return (
      <ErrorBanner
        message="Couldn't put this brief together. Try refreshing the page."
        onRetry={() => void brief.refetch()}
      />
    );
  }

  if (brief.isPending || !brief.data) return <SkeletonRows rows={6} />;

  const data = brief.data;
  const noBlockers =
    data.blockedTotal === 0 && data.lockedPhases.length === 0 && data.overdueTotal === 0;

  return (
    <div className="space-y-3">
      <Panel title="Progress">
        {/*
          A plain count of finished main tasks — deliberately NOT a bare percentage. The page header
          already shows the discipline-weighted figure (a task half-done still counts there); a
          second, count-based "%" beside it read as a contradiction ("50%" up top, "0%" here). The
          honest count and the week-over-week line below say everything without competing with it.
        */}
        <p className="text-sm text-[var(--brand-text)]">
          {data.progress.completed} of {data.progress.total} main tasks complete
        </p>
        <p className="text-xs text-[var(--brand-gray)]">{progressLine(data.progress)}</p>
      </Panel>

      <Panel title="Current blockers">
        {noBlockers ? (
          <p className="text-sm text-[var(--brand-text)]">
            Nothing blocked, no gate shut and nothing overdue.
          </p>
        ) : (
          <div className="space-y-2">
            {data.blockedTasks.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--brand-text)]">
                  Blocked discipline tasks ({data.blockedTotal})
                </p>
                <ul className="text-sm">
                  {data.blockedTasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--border)] py-1.5 last:border-b-0"
                    >
                      <Link
                        href={task.linkUrl}
                        className="font-semibold text-[var(--brand-primary)] hover:underline"
                      >
                        {task.title}
                      </Link>
                      <span className="text-xs text-[var(--brand-gray)]">{task.disciplineCode}</span>
                      <span className="text-xs text-[var(--brand-gray)]">{task.mainTaskTitle}</span>
                      <span className="text-xs text-[var(--brand-text)]">
                        {task.unmetDependencies.length === 0
                          ? "Marked blocked, with nothing named"
                          : `Waiting on ${task.unmetDependencies.join(", ")}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {data.blockedTotal > data.blockedTasks.length ? (
                  <p className="mt-1 text-xs text-[var(--brand-gray)]">
                    {data.blockedTotal - data.blockedTasks.length} more not shown.
                  </p>
                ) : null}
              </div>
            ) : null}

            {data.lockedPhases.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--brand-text)]">Locked phases</p>
                <ul className="text-sm text-[var(--brand-text)]">
                  {data.lockedPhases.map((phase) => (
                    <li key={phase.id} className="py-0.5">
                      {phase.name} — waiting on {phase.lockedByPhaseName ?? "earlier work"}, which
                      still has {phase.openTaskCount === 1 ? "1 main task" : `${phase.openTaskCount} main tasks`}{" "}
                      open
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.overdueByDiscipline.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--brand-text)]">
                  Overdue by discipline ({data.overdueTotal})
                </p>
                <ul className="flex flex-wrap gap-3 py-0.5 text-sm text-[var(--brand-text)]">
                  {data.overdueByDiscipline.map((row) => (
                    <li key={row.disciplineCode} className="inline-flex items-center gap-1">
                      <DisciplineDot colorHex={row.disciplineColorHex} code={row.disciplineCode} showCode />
                      <span>{row.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="What must happen next">
        {data.nextGate ? (
          <div>
            <p className="text-xs text-[var(--brand-gray)]">
              The “{data.nextGate.phaseName}” phase — {data.nextGate.total} main task
              {data.nextGate.total === 1 ? "" : "s"} still open. Nothing behind this gate can be
              completed until they are.
            </p>
            <ul className="text-sm">
              {data.nextGate.items.map((item) => (
                <TaskLine key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ) : null}

        {data.nearestDeadlines.length > 0 ? (
          <div className={data.nextGate ? "mt-2" : ""}>
            <p className="text-xs text-[var(--brand-gray)]">
              Work outside every phase, nearest deadlines first. No gate speaks for it.
            </p>
            <ul className="text-sm">
              {data.nearestDeadlines.map((item) => (
                <TaskLine key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ) : null}

        {!data.nextGate && data.nearestDeadlines.length === 0 ? (
          <p className="text-sm text-[var(--brand-text)]">
            Every main task on this project is complete.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
