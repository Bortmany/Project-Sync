// Notifications — the real feed arrives in a later milestone; the nav link needs a home until then.

import { EmptyState } from "@/components/ui";

export const metadata = { title: "Notifications — Project Nexus" };

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--olng-blue)]">Notifications</h1>
      <EmptyState message="Coming in a later milestone." />
    </div>
  );
}
