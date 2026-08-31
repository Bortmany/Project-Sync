// The front door: signed-in people go to their own home page, everyone else to the login page.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { homePathFor } from "@/components/shell/nav-items";

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
