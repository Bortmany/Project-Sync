// Dashboard — the landing screen. The frame renders on the server; the data regions are client-side.

import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata = { title: "Dashboard — Project Nexus" };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--olng-blue)]">Dashboard</h1>
      <DashboardView />
    </div>
  );
}
