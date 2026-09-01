// Sign-in screen: the ink hero on the left, the sign-in form on the right. People are added to an
// existing workspace by its administrator; a company without a workspace starts one at /signup.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { homePathFor } from "@/components/shell/nav-items";
import { AuthLegalLinks, AuthSplit, GoodNews } from "../auth-split";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Tielora" };

/**
 * The one-off good news somebody arrives with after setting a password. It is read from the address
 * bar once and never stored: refreshing without the parameter simply shows the ordinary page.
 */
const DONE_MESSAGES: Record<string, string> = {
  password:
    "Your password is changed, and you've been signed out everywhere else. Sign in with your new password.",
  invite: "You're all set — sign in with your new password to get started.",
  "account-deleted":
    "Your account has been deleted. Thanks for being part of Tielora — take care.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  const params = await searchParams;
  const done = params.done ? DONE_MESSAGES[params.done] : undefined;

  return (
    <AuthSplit>
      <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Sign in</h2>
      {/* The subline and the form's own spacing live inside LoginForm: the line under the heading
          changes when the form asks for a two-factor code, and one owner of that text is enough. */}
      {done ? (
        <div className="mt-6">
          <GoodNews>{done}</GoodNews>
        </div>
      ) : null}
      <LoginForm />
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
