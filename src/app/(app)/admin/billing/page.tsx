// Admin → Billing. Same gate as the Users, Disciplines, Integrations and Data & privacy pages:
// `can` here, `assertCan` again in the service, which is the check that actually matters.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminBillingView } from "@/components/admin/admin-billing-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { billingStatus } from "@/server/services/billing";

export const metadata = { title: "Billing — Tielora" };
export const dynamic = "force-dynamic";

export default async function AdminBillingPage({
  searchParams,
}: {
  // Set by the return from the provider's checkout — only "success" means anything, and even then
  // the page believes the database about the plan rather than the address bar.
  searchParams: Promise<{ billing?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "MANAGE_BILLING")) return <NoAccess />;

  const [status, params] = await Promise.all([billingStatus(actor), searchParams]);
  return <AdminBillingView status={status} outcome={params.billing} />;
}
