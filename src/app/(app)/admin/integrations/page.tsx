// Admin → Integrations. Same gate as the Users and Disciplines pages: `can` here, `assertCan`
// again in the service. The page never receives a saved webhook address — only scheme and host.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminIntegrationsView } from "@/components/admin/admin-integrations-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { emailAvailable } from "@/server/services/email";
import { listIntegrationsForAdmin } from "@/server/services/integrations";
import { microsoftConnectionFor } from "@/server/services/microsoft";
import { microsoftSignInStatus } from "@/server/services/microsoft-signin";
import { broadcastPolicyFor } from "@/server/services/posts";

export const metadata = { title: "Integrations — Tielora" };
export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage({
  searchParams,
}: {
  // `microsoft` is set by the files callback — "connected", "denied", "failed" or "setup".
  // `microsoftSignIn` is set by the sign-in callback after "Switch on" — "enabled", "denied",
  // "mismatch", "taken", "switchOffFirst" or "failed".
  searchParams: Promise<{ microsoft?: string; microsoftSignIn?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "MANAGE_INTEGRATIONS")) return <NoAccess />;

  const [integrations, microsoft, microsoftSignIn, broadcastPolicy, params] = await Promise.all([
    listIntegrationsForAdmin(actor),
    microsoftConnectionFor(actor),
    microsoftSignInStatus(actor),
    broadcastPolicyFor(actor),
    searchParams,
  ]);

  return (
    <AdminIntegrationsView
      integrations={integrations}
      microsoft={microsoft}
      microsoftOutcome={params.microsoft}
      microsoftSignIn={microsoftSignIn}
      microsoftSignInOutcome={params.microsoftSignIn}
      emailAvailable={emailAvailable()}
      broadcastPolicy={broadcastPolicy}
    />
  );
}
