// Admin → Integrations. Same gate as the Users and Disciplines pages: `can` here, `assertCan`
// again in the service. The page never receives a saved webhook address — only scheme and host.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminIntegrationsView } from "@/components/admin/admin-integrations-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { listIntegrationsForAdmin } from "@/server/services/integrations";

export const metadata = { title: "Integrations — Tielora" };
export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "MANAGE_INTEGRATIONS")) return <NoAccess />;

  const integrations = await listIntegrationsForAdmin(actor);

  return <AdminIntegrationsView integrations={integrations} />;
}
