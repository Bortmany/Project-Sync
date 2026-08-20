// The front door: signed-in people go to the dashboard, everyone else to the login page.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? "/dashboard" : "/login");
}
