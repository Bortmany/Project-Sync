// "I forgot my password". A public page that never says whether an address has an account — the
// same confirmation appears whatever was typed in, and the route behind it answers identically too.
//
// With no mail provider set up the form is not rendered at all: the check is a plain `if` on the
// server, so nobody ever sees a form flash and disappear, and the page says what to do instead
// without naming a single setting — the same discretion the Microsoft and chat cards use.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { homePathFor } from "@/components/shell/nav-items";
import { EMAIL_DORMANT_MESSAGE } from "@/server/services/account";
import { emailAvailable } from "@/server/services/email";
import { AuthLegalLinks, AuthSplit, BackToSignIn } from "../auth-split";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password — Tielora" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  const available = emailAvailable();

  return (
    <AuthSplit>
      <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Reset your password</h2>
      {available ? (
        <>
          <p className="mt-1 text-sm text-[var(--brand-text)]">
            Enter the work email you sign in with. If it has a Tielora account, we&apos;ll send a
            link to reset your password.
          </p>
          <div className="mt-6">
            <ForgotPasswordForm />
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-[var(--brand-text)]">{EMAIL_DORMANT_MESSAGE}</p>
          <BackToSignIn />
        </>
      )}
      <AuthLegalLinks />
    </AuthSplit>
  );
}
