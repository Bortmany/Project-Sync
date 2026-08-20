// Placeholder dashboard — Milestone 2 replaces this with the real widget grid.

import { requireUser } from "@/lib/auth";
import { Card } from "@/components/ui";

export const metadata = { title: "Dashboard — Project Nexus" };

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--olng-navy)]">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-[var(--olng-text)]">
          Your overview of projects, tasks and deadlines.
        </p>
      </div>

      <Card title="Dashboard">
        <p className="text-sm text-[var(--olng-text)]">Dashboard coming in this build.</p>
      </Card>
    </div>
  );
}
