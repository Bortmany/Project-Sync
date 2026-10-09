// Your account: what Tielora holds about you, and what you can do with it yourself.
//
// No admin gate at all — every signed-in role reaches this page, contractors included, because it
// is about their own data rather than the company's. The workspace-wide equivalent is Admin →
// Data & privacy, and only an administrator sees that one.

import { redirect } from "next/navigation";
import { AccountView } from "@/components/account/account-view";
import { DeleteAccountCard } from "@/components/account/delete-account-card";
import { EmailPreferencesCard } from "@/components/account/email-preferences-card";
import { TwoFactorCard } from "@/components/account/two-factor-card";
import { isExternal } from "@/server/actor";
import { currentActor } from "@/server/session";
import { accountDeletionOptions } from "@/server/services/account-deletion";
import { emailPreferencesFor } from "@/server/services/email-preferences";
import { twoFactorStatus } from "@/server/services/two-factor";

export const metadata = { title: "Your account — Tielora" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  // Worked out on the server so the guidance is on the page before anybody types the word. The
  // service checks it again when the button is pressed, which is the check that actually refuses.
  const options = await accountDeletionOptions(actor);

  // Read on the server, like the sole-administrator hint above it, so the card is right on the
  // first paint rather than flickering from "off" to "on". Never the secret, never a code.
  const twoFactor = await twoFactorStatus(actor);

  // Your own email choices, read the same way. While this Tielora sends no email the card is not
  // drawn at all — nobody signed in can fix that, and a greyed card would advertise a feature that
  // does not exist here.
  const emailPreferences = await emailPreferencesFor(actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Your account</h1>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Your own data, and what you can do with it.
        </p>
      </div>

      <div className="max-w-2xl space-y-8">
        <AccountView />
        <TwoFactorCard
          enabled={twoFactor.enabled}
          enabledAt={twoFactor.enabledAt}
          recoveryCodesLeft={twoFactor.recoveryCodesLeft}
        />
        {emailPreferences.available ? (
          <EmailPreferencesCard preferences={emailPreferences} external={isExternal(actor)} />
        ) : null}
        {/* The danger zone, red-tinted and set apart by the space-y-8 gap above it. */}
        <DeleteAccountCard soleAdmin={options.soleAdmin} />
      </div>
    </div>
  );
}
