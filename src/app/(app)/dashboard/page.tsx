// Dashboard — the landing screen. The frame renders on the server; the data regions are client-side.

import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { homePathFor } from "@/components/shell/nav-items";
import { requireUser } from "@/lib/auth";
import { currentActor } from "@/server/session";
import { askTieloraProjects } from "@/server/services/ai-panel";

export const metadata = { title: "Dashboard — Tielora" };

export default async function DashboardPage() {
  // A contractor has no company overview to land on: their home is My tasks, which is also the
  // first row of their sidebar. An old link or bookmark goes there instead of to a half-empty page.
  const user = await requireUser();
  if (user.role === "EXTERNAL") redirect(homePathFor(user.role));

  // Ask Tielora's card: a list of the person's own projects when the server says it may be drawn
  // (key set, their company's switch on, internal role, on at least one project), otherwise null.
  const actor = await currentActor();
  const askProjects = actor ? await askTieloraProjects(actor) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Dashboard</h1>
      <DashboardView askProjects={askProjects} />
    </div>
  );
}
