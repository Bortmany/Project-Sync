// Public terms-of-use page — no session required. Internal-use scope only; see docs/GO-LIVE.md gate 1.

import Link from "next/link";

export const metadata = { title: "Terms of use — Tielora" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--brand-accent)]">
        Tielora
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--brand-ink)]">Terms of use</h1>
      <p className="mt-1 text-sm text-[var(--brand-gray)]">Last updated 31 Aug 2026</p>

      <div className="mt-6 rounded-[var(--radius)] border border-[var(--brand-stone)] bg-[var(--brand-stone)]/40 p-4 text-sm text-[var(--brand-text)]">
        This is a template written to describe the app honestly. It has not yet been reviewed by a
        lawyer, and should be before the app is relied on for real projects.
      </div>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">How access works</h2>
        <p>
          Tielora is a coordination tool for companies doing multidisciplinary engineering work. Each
          company has its own workspace, and no one workspace can see another. Whoever signs a
          company up becomes its administrator; every other account in that workspace is created and
          removed by that administrator. Access is granted to do your job on your company&apos;s
          projects, not for any other purpose.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Your account</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Keep your password confidential and do not share your account with anyone else.</li>
          <li>
            You are responsible for actions taken under your account — every action is recorded
            against your name in the permanent audit trail described in the{" "}
            <Link href="/privacy" className="text-[var(--brand-primary)] underline-offset-2 hover:underline">
              privacy notice
            </Link>
            .
          </li>
          <li>Tell an administrator promptly if you suspect your account has been compromised.</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Acceptable use</h2>
        <p>
          Use Tielora only for legitimate engineering coordination work for the company whose
          workspace you are in. Do not upload documents, comments, or other content you do not have
          the right to share there, and do not attempt to access projects, tasks, or documents you
          have not been given permission to see. Your administrator can adjust or revoke access at
          any time.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Deleting an account or a workspace
        </h2>
        <p>
          You can delete your own account at any time from <strong>Your account</strong>. It signs
          you out and removes your personal details, replacing your name with &ldquo;Former
          member&rdquo;; your comments, completed work and uploaded document revisions stay on your
          company&apos;s record, because that record belongs to the project rather than to you
          alone. If you are your workspace&apos;s only administrator, make someone else an
          administrator first — Tielora will not let a company be left with nobody able to run it.
        </p>
        <p>
          An administrator can delete the entire workspace from{" "}
          <strong>Admin → Data &amp; privacy</strong>. There is a 7-day grace period, during which
          any administrator can cancel and the workspace keeps working normally. After that,
          everything the workspace holds is permanently deleted — every account, project, task,
          comment, document, uploaded file and the whole activity log — and{" "}
          <strong>it cannot be recovered</strong>. Download a copy of anything you need to keep
          before the grace period ends; the same screen has a &ldquo;Download everything&rdquo;
          button for exactly that.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">No warranty</h2>
        <p>
          Tielora is provided as a coordination aid. It does not replace engineering judgment,
          formal approvals, or the controlled processes your company already requires for project
          deliverables — it exists to track and support that work, not to certify it.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Questions</h2>
        <p>
          Questions about these terms, or about your account, go to{" "}
          <strong>your workspace administrator</strong>.
        </p>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        <Link
          href="/privacy"
          className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Privacy notice
        </Link>
        <Link
          href="/dashboard"
          className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Back to Tielora
        </Link>
      </div>
    </main>
  );
}
