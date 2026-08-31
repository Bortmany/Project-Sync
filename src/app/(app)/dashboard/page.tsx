// Dashboard — the landing screen. The frame renders on the server; the data regions are client-side.

import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { homePathFor } from "@/components/shell/nav-items";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Dashboard — Tielora" };

export default async function DashboardPage() {
  // A contractor has no company overview to land on: their home is My tasks, which is also the
  // first row of their sidebar. An old link or bookmark goes there instead of to a half-empty page.
  const user = await requireUser();
  if (user.role === "EXTERNAL") redirect(homePathFor(user.role));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Dashboard</h1>
      <DashboardView />
    </div>
  );
}
