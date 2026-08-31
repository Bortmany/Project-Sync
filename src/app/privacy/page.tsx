// Public privacy notice — no session required. Content is drawn from what the app actually stores
// (see docs/GO-LIVE.md, gate 1); keep the two in step whenever a change adds a new kind of personal
// data (house rule 12 in docs/CONVENTIONS.md).

import Link from "next/link";

export const metadata = { title: "Privacy notice — Tielora" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--brand-accent)]">
        Tielora
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--brand-ink)]">Privacy notice</h1>
      <p className="mt-1 text-sm text-[var(--brand-gray)]">Last updated 25 Aug 2026</p>

      <div className="mt-6 rounded-[var(--radius)] border border-[var(--brand-stone)] bg-[var(--brand-stone)]/40 p-4 text-sm text-[var(--brand-text)]">
        This notice is a template written to describe the app honestly. It has not yet been reviewed
        by a lawyer, and should be before the app is relied on for real projects.
      </div>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Who this covers</h2>
        <p>
          This is a coordination tool for companies doing multidisciplinary engineering work. Each
          company has its own separate space: nobody in one company can see the people, projects,
          tasks, documents or comments of another.
        </p>
        <p>
          There are two ways to get an account. Someone signing their company up creates the first
          one for themselves and becomes its administrator; everybody after them is given an account
          by that administrator. Either way, your information belongs to the company whose space you
          are in, and this notice applies to you from the moment the account exists.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">What is stored</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>People:</strong> name, work email, job title, role, discipline, a password that is
            hashed and never stored or shown in readable form, and whether the account is active.
          </li>
          <li>
            <strong>Your company:</strong> the company name given at sign-up, the handle made from it,
            and the industry template its starting list of disciplines came from.
          </li>
          <li>
            <strong>Sessions:</strong> a hashed sign-in token, the IP address and browser used to sign
            in, and when the session expires.
          </li>
          <li>
            <strong>Work:</strong> projects, tasks, comments, uploaded documents and every revision of
            them, and an audit trail of who did what and when.
          </li>
          <li>
            <strong>Notifications:</strong> what you were alerted about, and whether you have read it.
          </li>
          <li>
            <strong>A personal to-do list</strong>, if you choose to use one — the notes you type there
            are private to your account and visible to nobody else.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Document revisions and the audit trail are permanent
        </h2>
        <p>
          This app&apos;s core purpose is a reliable record of engineering coordination work. Once a
          document revision or an audit entry is created, it is never edited or deleted — even by an
          administrator. Please keep this in mind before uploading or writing anything: a corrected
          version can always be added, but the earlier one stays in the history.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Why this is stored</h2>
        <p>
          Solely to run multidisciplinary project coordination for the company whose workspace you
          are in: assigning and tracking work, gating task completion on required documents, keeping
          a dependable audit trail, and notifying people about work relevant to them. Nothing here is
          used for advertising, and nothing is sold or shared with anyone outside your company.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Your rights</h2>
        <p>
          Your information is held inside your own company&apos;s space, so requests to see, correct,
          or remove your personal information are handled by{" "}
          <strong>your workspace administrator</strong> rather than through a self-service page. Deactivating an account keeps the audit trail and
          document history intact, as explained above — that record is part of the engineering work
          itself, not personal data held about you alone.
        </p>
        <p>
          This handling is intended to respect Oman&apos;s Personal Data Protection Law (Royal Decree
          6/2022). If you have a question or concern about how your information is handled, raise it
          with your workspace administrator, who is the contact for your company&apos;s data.
        </p>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        <Link
          href="/terms"
          className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Terms of use
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
