// Admin → Data & privacy. Same gate as the Users, Disciplines and Integrations pages: `can` here,
// `assertCan` again in the service, which is the check that actually matters.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminDataPrivacyView } from "@/components/admin/admin-data-privacy-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { workspaceDeletionStatus } from "@/server/services/workspace-deletion";
import { workspaceExportStatus } from "@/server/services/workspace-export";

export const metadata = { title: "Data & privacy — Tielora" };
export const dynamic = "force-dynamic";

export default async function AdminDataPrivacyPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "EXPORT_ORG")) return <NoAccess />;

  const status = await workspaceExportStatus(actor);
  const deletion = await workspaceDeletionStatus(actor);
  return <AdminDataPrivacyView status={status} deletion={deletion} />;
}
