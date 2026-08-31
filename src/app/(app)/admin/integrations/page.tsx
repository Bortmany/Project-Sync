// Admin → Integrations. Same gate as the Users and Disciplines pages: `can` here, `assertCan`
// again in the service. The page never receives a saved webhook address — only scheme and host.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminIntegrationsView } from "@/components/admin/admin-integrations-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { listIntegrationsForAdmin } from "@/server/services/integrations";
import { microsoftConnectionFor } from "@/server/services/microsoft";
import { broadcastPolicyFor } from "@/server/services/posts";

export const metadata = { title: "Integrations — Tielora" };
export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage({
  searchParams,
}: {
  // Set by the Microsoft callback — "connected", "denied", "failed" or "setup".
  searchParams: Promise<{ microsoft?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "MANAGE_INTEGRATIONS")) return <NoAccess />;

  const [integrations, microsoft, broadcastPolicy, params] = await Promise.all([
    listIntegrationsForAdmin(actor),
    microsoftConnectionFor(actor),
    broadcastPolicyFor(actor),
    searchParams,
  ]);

  return (
    <AdminIntegrationsView
      integrations={integrations}
      microsoft={microsoft}
      microsoftOutcome={params.microsoft}
      broadcastPolicy={broadcastPolicy}
    />
  );
}
