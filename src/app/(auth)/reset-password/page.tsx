// Choosing a new password from a reset link.
//
// The token is checked HERE, on the server, before anything renders — `previewEmailToken()` looks
// at the link without spending it — so there is no flash of a form that then disappears, and a link
// that is wrong, tampered with, expired or already used all produce the same one paragraph. The
// link itself is only spent when the form is submitted.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { EmailTokenSchema } from "@/lib/zod-schemas";
import { homePathFor } from "@/components/shell/nav-items";
import { previewEmailToken } from "@/server/services/email-tokens";
import { AuthLegalLinks, AuthSplit, BackToSignIn } from "../auth-split";
import { ChoosePasswordForm } from "../choose-password-form";

export const metadata = { title: "Choose a new password — Tielora" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  const params = await searchParams;
  const parsed = EmailTokenSchema.safeParse(params.token ?? "");
  const holder = parsed.success ? await previewEmailToken(parsed.data, "RESET") : null;

  if (!holder) {
    return (
      <AuthSplit>
        <h2 className="text-xl font-semibold text-[var(--brand-ink)]">This link no longer works</h2>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          It may have expired or already been used. Request a new one below.
        </p>
        <p className="mt-6">
          <Link
            href="/forgot-password"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-mid)]"
          >
            Send a new link
          </Link>
        </p>
        <BackToSignIn />
        <AuthLegalLinks />
      </AuthSplit>
    );
  }

  return (
    <AuthSplit>
      <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Choose a new password</h2>
      <p className="mt-1 text-sm text-[var(--brand-text)]">
        Pick a new password for your Tielora account.
      </p>
      <div className="mt-6">
        <ChoosePasswordForm mode="reset" token={parsed.success ? parsed.data : ""} />
      </div>
      <AuthLegalLinks />
    </AuthSplit>
  );
}
