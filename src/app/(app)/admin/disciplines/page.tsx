// Admin → Disciplines. Same gate as the Users page: `can` here, `assertCan` again in the service.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminDisciplinesView } from "@/components/admin/admin-disciplines-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { listDisciplinesForAdmin } from "@/server/services/admin";

export const metadata = { title: "Disciplines — Tielora" };
export const dynamic = "force-dynamic";

export default async function AdminDisciplinesPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "MANAGE_DISCIPLINES")) return <NoAccess />;

  const disciplines = await listDisciplinesForAdmin(actor);

  return <AdminDisciplinesView disciplines={disciplines} />;
}
