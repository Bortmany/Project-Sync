// Sign-in screen: the ink hero on the left, the sign-in form on the right. People are added to an
// existing workspace by its administrator; a company without a workspace starts one at /signup.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AuthLegalLinks, AuthSplit } from "../auth-split";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Tielora" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <AuthSplit>
      <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Sign in</h2>
      <p className="mt-1 text-sm text-[var(--brand-text)]">
        Use your work email. Accounts are set up by your workspace administrator.
      </p>
      <div className="mt-6">
        <LoginForm />
      </div>
      <p className="mt-6 text-sm text-[var(--brand-text)]">
        Setting up a new company?{" "}
        <Link
          href="/signup"
          className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Create a workspace.
        </Link>
      </p>
      <AuthLegalLinks />
    </AuthSplit>
  );
}
