// Notifications — everything waiting for the signed-in person. The list itself is client-side so the
// bell and this page share one cache and clear together.

import { NotificationsView } from "@/components/notifications/notifications-view";

export const metadata = { title: "Notifications — Project Nexus" };

export default function NotificationsPage() {
  return <NotificationsView />;
}
