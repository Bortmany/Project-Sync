// The list a dashboard tile opens. It is built by the same filter the tile's number uses
// (listTileWork in src/server/services/dashboard.ts), so the count on the tile and the rows here
// are always the same. Reads only; scoped to the projects this person may see (a contractor: their
// own work).

import Link from "next/link";
import { WorkRow } from "@/components/dashboard/work-row";
import { requireUser } from "@/lib/auth";
import { actorForUser } from "@/server/actor";
import { listTileWork, TILE_KEYS, type TileKey } from "@/server/services/dashboard";

export const metadata = { title: "Tasks — Tielora" };
export const dynamic = "force-dynamic";

const TITLES: Record<TileKey, string> = {
  all: "All tasks",
  "in-progress": "In progress",
  completed: "Completed",
  blocked: "Blocked",
  late: "Late",
  upcoming: "Due in 14 days",
};

export default async function DashboardListPage({
  searchParams,
}: {
  searchParams: Promise<{ tile?: string }>;
}) {
  const { tile: raw } = await searchParams;
  const tile: TileKey = TILE_KEYS.find((key) => key === raw) ?? "all";
  const user = await requireUser();
  const actor = await actorForUser(user.id);
  const { scope, total, items } = await listTileWork(actor, tile);

  return (
    <div className="space-y-4">
      <Link
        href={scope === "OWN" ? "/my-tasks" : "/dashboard"}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)]"
      >
        {scope === "OWN" ? "← Back to My tasks" : "← Back to the dashboard"}
      </Link>
      <h1 className="text-xl font-semibold text-[var(--brand-primary)]">
        {TITLES[tile]} ({total})
      </h1>
      <p className="text-xs text-[var(--brand-text)]">
        {scope === "OWN" ? "Your work" : "Across the whole company"}
        {scope === "COMPANY" ? " · main tasks and discipline tasks" : ""}
      </p>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--brand-text)]">Nothing here right now.</p>
      ) : (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
          <ul className="divide-y divide-[var(--border)]">
            {items.map((item) => (
              <WorkRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </ul>
          {total > items.length ? (
            <p className="pt-2 text-xs text-[var(--brand-text)]">
              Showing the first {items.length} of {total}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
