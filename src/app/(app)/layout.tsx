// The signed-in shell: everything inside here requires a session.

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { DeletionBanner } from "@/components/shell/deletion-banner";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { VerificationBanner } from "@/components/shell/verification-banner";
import { needsVerificationNudge } from "@/server/services/account";
import { pendingWorkspaceDeletion } from "@/server/services/workspace-deletion";
import { Providers } from "./providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Only when this deployment can send email AND this person has no verified address. It is a
  // nudge, never a lock: nothing below this line behaves differently either way.
  const unverified = await needsVerificationNudge(user.id);
  // Administrators only, and only while a deletion is actually counting down. Null the rest of the
  // time, which is almost always: one small indexed read per page load.
  const pendingDeletion = await pendingWorkspaceDeletion(user);

  return (
    <Providers>
      <div className="flex min-h-screen">
        <Sidebar role={user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The countdown first: it outranks every other strip on the page. */}
          {pendingDeletion?.deletesOn ? (
            <DeletionBanner deletesOn={pendingDeletion.deletesOn} />
          ) : null}
          {unverified ? <VerificationBanner email={user.email} /> : null}
          <Topbar name={user.name} email={user.email} role={user.role} />
          <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
          <footer className="border-t border-[var(--brand-stone)] px-4 py-3 text-xs text-[var(--brand-gray)] sm:px-6">
            Tielora &middot;{" "}
            <Link href="/privacy" className="underline-offset-2 hover:underline">
              Privacy notice
            </Link>{" "}
            &middot;{" "}
            <Link href="/terms" className="underline-offset-2 hover:underline">
              Terms of use
            </Link>
          </footer>
        </div>
      </div>
    </Providers>
  );
}
