// Accepting an invitation: the first thing a new colleague ever does in Tielora.
//
// The welcoming twin of /reset-password, and the same shape underneath: the token is looked at on
// the server without being spent, and the address shown belongs to the token — never to the query
// string, which nobody may put a name to.
//
// One difference in the dead-link state: there is no "send me another" button here. Somebody who
// has not accepted an invitation yet has no account to request a reset for, so the only way forward
// is asking whoever invited them.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { EmailTokenSchema } from "@/lib/zod-schemas";
import { homePathFor } from "@/components/shell/nav-items";
import { previewEmailToken } from "@/server/services/email-tokens";
import { AuthLegalLinks, AuthSplit, BackToSignIn } from "../auth-split";
import { ChoosePasswordForm } from "../choose-password-form";

export const metadata = { title: "Welcome to Tielora" };
export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  const params = await searchParams;
  const parsed = EmailTokenSchema.safeParse(params.token ?? "");
  const invited = parsed.success ? await previewEmailToken(parsed.data, "INVITE") : null;

  if (!invited) {
    return (
      <AuthSplit>
        <h2 className="text-xl font-semibold text-[var(--brand-ink)]">
          This invite link no longer works
        </h2>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          It may have expired or already been used. Ask whoever invited you to send a new one.
        </p>
        <BackToSignIn />
        <AuthLegalLinks />
      </AuthSplit>
    );
  }

  return (
    <AuthSplit>
      <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Welcome to Tielora</h2>
      <p className="mt-1 text-sm text-[var(--brand-text)]">
        Choose a password for{" "}
        <span className="font-semibold text-[var(--brand-ink)]">{invited.email}</span>. This is the
        address your invite was sent to.
      </p>
      <div className="mt-6">
        <ChoosePasswordForm mode="invite" token={parsed.success ? parsed.data : ""} />
      </div>
      <AuthLegalLinks />
    </AuthSplit>
  );
}
