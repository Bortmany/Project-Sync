// Admin → Users. Read on the server, gated on the server: only an administrator gets past `can`,
// and the service asserts the same permission again before it returns a single row.

import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { AdminUsersView } from "@/components/admin/admin-users-view";
import { NoAccess } from "@/components/admin/no-access";
import { currentActor } from "@/server/session";
import { listAllUsers } from "@/server/services/admin";
import { listDisciplines } from "@/server/services/directory";

export const metadata = { title: "Users — Project Nexus" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor, "MANAGE_USERS")) return <NoAccess />;

  const [users, disciplines] = await Promise.all([listAllUsers(actor), listDisciplines(actor)]);

  return <AdminUsersView users={users} disciplines={disciplines} />;
}
