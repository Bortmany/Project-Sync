// Public terms-of-use page — no session required. Internal-use scope only; see docs/GO-LIVE.md gate 1.

import Link from "next/link";

export const metadata = { title: "Terms of use — Project Nexus" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--olng-sail)]">
        Oman LNG
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--olng-navy)]">Terms of use</h1>
      <p className="mt-1 text-sm text-[var(--olng-gray)]">Last updated 25 Aug 2026</p>

      <div className="mt-6 rounded-[var(--radius)] border border-[var(--olng-sand)] bg-[var(--olng-sand)]/40 p-4 text-sm text-[var(--olng-text)]">
        This is a template written to describe the app honestly. It has not yet been reviewed by Oman
        LNG legal or compliance, and should be before the app is relied on for real projects.
      </div>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--olng-text)]">
        <h2 className="text-base font-semibold text-[var(--olng-navy)]">Internal use only</h2>
        <p>
          Project Nexus is a private tool for Oman LNG staff and contractors coordinating
          multidisciplinary engineering work. It is not available to the public, has no sign-up, and
          every account is created and removed by an administrator. Access is granted to do your job
          on Oman LNG projects, not for any other purpose.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--olng-text)]">
        <h2 className="text-base font-semibold text-[var(--olng-navy)]">Your account</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Keep your password confidential and do not share your account with anyone else.</li>
          <li>
            You are responsible for actions taken under your account — every action is recorded
            against your name in the permanent audit trail described in the{" "}
            <Link href="/privacy" className="text-[var(--olng-blue)] underline-offset-2 hover:underline">
              privacy notice
            </Link>
            .
          </li>
          <li>Tell an administrator promptly if you suspect your account has been compromised.</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--olng-text)]">
        <h2 className="text-base font-semibold text-[var(--olng-navy)]">Acceptable use</h2>
        <p>
          Use Project Nexus only for legitimate Oman LNG engineering coordination work. Do not upload
          documents, comments, or other content you do not have the right to share internally, and do
          not attempt to access projects, tasks, or documents you have not been given permission to
          see. Administrators can adjust or revoke access at any time.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--olng-text)]">
        <h2 className="text-base font-semibold text-[var(--olng-navy)]">No warranty</h2>
        <p>
          Project Nexus is provided as an internal coordination aid. It does not replace engineering
          judgment, formal approvals, or the controlled processes Oman LNG already requires for
          project deliverables — it exists to track and support that work, not to certify it.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--olng-text)]">
        <h2 className="text-base font-semibold text-[var(--olng-navy)]">Questions</h2>
        <p>
          Questions about these terms, or about your account, go to{" "}
          <strong>your Project Nexus administrator</strong>.
        </p>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        <Link
          href="/privacy"
          className="font-medium text-[var(--olng-blue)] underline-offset-2 hover:underline"
        >
          Privacy notice
        </Link>
        <Link
          href="/dashboard"
          className="font-medium text-[var(--olng-blue)] underline-offset-2 hover:underline"
        >
          Back to Project Nexus
        </Link>
      </div>
    </main>
  );
}
