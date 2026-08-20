// /admin has no screen of its own — it opens the people directory, the first Admin tab.

import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/admin/users");
}
