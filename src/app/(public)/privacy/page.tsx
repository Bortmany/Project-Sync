// Public privacy notice — no session required. Content is drawn from what the app actually stores
// (see docs/GO-LIVE.md, gate 1); keep the two in step whenever a change adds a new kind of personal
// data (house rule 12 in docs/CONVENTIONS.md).
//
// "Your rights" describes both halves of self-service data rights: downloading a copy, and deleting
// — your own account, or (for an administrator) the whole workspace. Every sentence there is meant
// to be literally true of what the code does, so keep the two in step.
//
// It lives in the (public) route group, so the public nav and footer wrap it. The group adds
// nothing to the address: this page is still /privacy.

import { LegalPage } from "@/components/public/legal-page";
import { privacyContactEmail } from "@/lib/legal-contact";

export const metadata = { title: "Privacy notice — Tielora" };

export default function PrivacyPage() {
  // Read on the server at render time (PRIVACY_CONTACT_EMAIL, or the owner's address by default).
  const contactEmail = privacyContactEmail();
  return (
    <LegalPage
      title="Privacy notice"
      lastUpdated="1 Oct 2026"
      notice="This notice is a template written to describe the app honestly. It has not yet been reviewed by a lawyer, and should be before the app is relied on for real projects."
      otherHref="/terms"
      otherLabel="Terms of use"
    >
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
            <strong>External contractors:</strong> when someone from another company is invited in as
            a contractor, the name of the company they work for is stored alongside their account and
            shown beside their name on the work they touch, so everybody here knows who they are
            dealing with. A contractor only ever sees the tasks assigned to them — not the team list,
            not other people&apos;s work, and not another company&apos;s data. An administrator may
            also set a date their access ends; that date is stored on the account, shown on the admin
            people screen, and after it they can no longer sign in. Their work, comments and
            documents stay on record as described below.
          </li>
          <li>
            <strong>Your company:</strong> the company name given at sign-up, the handle made from it,
            and the industry template its starting list of disciplines came from.
          </li>
          <li>
            <strong>Sessions:</strong> a hashed sign-in token, the IP address and browser used to sign
            in, and when the session expires. Inside Microsoft Teams, Tielora uses a separate sign-in
            cookie that only works within Teams.
          </li>
          <li>
            <strong>Email links, if your company has email switched on:</strong> when you are invited,
            ask to reset your password, or are asked to confirm your address, we store a scrambled
            copy of that one-time link — never the link itself — along with which account it belongs
            to, when it stops working, and when it was used. Each link works once and then expires,
            asking for a new one retires the old one, and the record of the link is deleted with the
            account. We also store whether your address has been confirmed and when; if you never
            confirm it, nothing is taken away from you — it is only a reminder.
          </li>
          <li>
            <strong>Two-factor sign-in, if you switch it on:</strong> the secret your authenticator
            app uses is stored encrypted — never in readable form, never shown again after you have
            scanned it, and never included in any copy of your data. We also store when you switched
            it on and a marker of the last code you used, which is what stops the same code being
            used twice. Your eight recovery codes are stored only as scrambled copies, so nobody —
            including us — can read them back; if you lose them, you generate new ones and the old
            ones stop working. Turning two-factor off, an administrator resetting it for you, or
            deleting your account removes all of it.
          </li>
          <li>
            <strong>Work:</strong> projects, tasks, comments, uploaded documents and every revision of
            them, and an audit trail of who did what and when.
          </li>
          <li>
            <strong>Notifications:</strong> what you were alerted about, and whether you have read it.
          </li>
          <li>
            <strong>Announcements and the team board:</strong> the posts and replies you write, who
            wrote them and when, which audience they were for, and which announcements you have
            dismissed from your own dashboard. A dismissal is yours alone — nobody can see what you
            have hidden. When an announcement asks you to acknowledge it, we record that you did and
            when: the person who posted it, and your administrator, can see who has acknowledged it
            and who has not yet — nobody else can, and it is kept in the audit trail like any other
            piece of work you do. A removed post stays as &quot;Post removed&quot; so the replies
            under it still make sense. External contractors have no team board and are never sent
            announcements.
          </li>
          <li>
            <strong>A personal to-do list</strong>, if you choose to use one — the notes you type there
            are private to your account and visible to nobody else.
          </li>
          <li>
            <strong>A Microsoft 365 connection</strong>, if your administrator sets one up: which
            Microsoft work domain it is, which administrator connected it and when, and the sign-in
            tokens for that one account, kept encrypted and never shown to anybody. See below.
          </li>
          <li>
            <strong>Your Microsoft sign-in link, if you use it:</strong> a permanent identifier
            Microsoft gives us for your work account and the identifier of your company&apos;s
            Microsoft directory, kept so we recognise you next time. For each company that switches
            Microsoft sign-in on, we also store its Microsoft directory identifier. See
            &ldquo;Signing in with Microsoft&rdquo; below.
          </li>
          <li>
            <strong>Your email choices:</strong> whether you want alert emails, a daily brief and a
            weekly summary, and the dates your last daily brief and weekly summary emails were sent.
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
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Chat notifications, if your administrator switches them on
        </h2>
        <p>
          Your workspace administrator can connect one Slack channel and one Microsoft Teams channel
          to your company&apos;s workspace. When that is switched on, a copy of the notifications
          they have chosen — the same short headline, sentence and link you would see in the app —
          is posted to that channel. Those messages can include a task title and the name of the
          person involved, and they are then held by Slack or Microsoft under that company&apos;s own
          agreement with them, not ours.
        </p>
        <p>
          A connected channel receives headlines for every project in the company, not only the
          projects its members work on, so whoever can see that channel can see them — channel
          membership decides the audience, not project membership.
        </p>
        <p>
          It is off unless your administrator turns it on, they choose which kinds of notification go
          out, and they can switch it off or remove it at any time in Admin → Integrations. Nothing
          else is sent: no documents, no comments in full, no email addresses and no passwords.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Microsoft 365 files, if your administrator connects them
        </h2>
        <p>
          Your workspace administrator can connect your company&apos;s OneDrive and SharePoint so
          people can attach a document that already lives there. We store which Microsoft work domain
          it is, who connected it and when, and the sign-in tokens for that one account — encrypted,
          never shown to anybody and never sent anywhere else. Removing the connection deletes them.
        </p>
        <p>
          When somebody attaches a file, we ask Microsoft for that file and copy it into Tielora as
          an ordinary document revision, which then follows the permanence rule above. We never
          write anything back to Microsoft, never change or delete anything there, and never list
          files for anybody who could not already upload to the task they are attaching to.
        </p>
        <p>
          Everyone in the company browses through the account the administrator connected, so the
          list of files people can see is what that one account can see. It is off unless your
          administrator switches it on, and they can disconnect it at any time in Admin →
          Integrations.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Paying for a plan, if your company does
        </h2>
        <p>
          Payments are handled entirely by Paddle, which is the seller of record: you buy from
          Paddle, they take the payment, they work out and charge the right tax for your country,
          and they issue the receipt. When your administrator upgrades, they are taken to Paddle&apos;s
          own page to pay and come straight back here afterwards.
        </p>
        <p>
          <strong>No card details ever reach this app.</strong> We store which plan your company is
          on and two identifiers Paddle gives us for your company&apos;s customer and subscription
          records — nothing else. No card number, no billing address, no invoice and no amount is
          held here. &quot;Manage billing&quot; opens your own page at Paddle, where those things
          live, and what you do there is covered by Paddle&apos;s own privacy policy rather than
          this one.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">The emails we send you</h2>
        <p>
          Three emails are about your account: an invitation to set your first password, a password
          reset you asked for, and a request to confirm your email address. Each carries your name
          and a link that works once and then expires.
        </p>
        <p>
          The others are about your work, and you choose them. <strong>Alert emails</strong> are one
          email for each alert you would see in the app — a task assigned to you, a mention, a
          change on your work, a deadline coming up or passed, a stage opened by an override, or a
          company announcement. Each one contains what that in-app notification says and nothing
          else: its headline, its sentence and a link back to Tielora. A <strong>daily brief</strong>{" "}
          is your own &ldquo;Your day&rdquo; page, sent early each morning (UTC) and skipped on a day
          with nothing in it, and a <strong>weekly summary</strong> works the same way once a
          week, every Monday morning (UTC), and lists only the projects you belong to.
          Uploads and ordinary comments are never emailed.
        </p>
        <p>
          These are off unless you switch them on — except that when your account is newly created,
          alert emails start switched on, and both briefs start off. They go only to an address you
          have confirmed, every one has a one-click unsubscribe link, and you can change all of them
          at any time on <strong>Your account</strong>. External contractors can only choose alert
          emails, and only for their own work; they are never sent a brief.
        </p>
        <p>
          All of these emails are sent through Resend, an email delivery service, which handles your
          name, your address and the email itself in order to deliver it. We keep no copy of any
          email. If your company has not switched email on, none of them are sent at all and your
          administrator sets passwords for you instead.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Signing in with Microsoft
        </h2>
        <p>
          If your company&apos;s administrator switches it on, you can sign in with the Microsoft work
          account you already use instead of your Tielora password. Your password keeps working
          either way, and it only works if you already have a Tielora account.
        </p>
        <p>
          When you sign in this way, Microsoft tells us which company&apos;s Microsoft directory you
          belong to, a permanent identifier for your work account, and your work email address. We
          ask only for the basic sign-in permissions — who you are, and nothing else. We do not read
          your mailbox, your files or your contacts to sign you in, and we keep no Microsoft sign-in
          token: only the two identifiers listed above, so we recognise you next time. Your email
          address is used only to find your Tielora account the first time.
        </p>
        <p>
          If you have switched on two-factor sign-in in Tielora, you are still asked for your code
          after Microsoft. The permanent identifier Microsoft gives your own work account never
          appears in the activity trail, in our logs or in either copy of your data, and your link is
          removed when you delete your account or your administrator switches Microsoft sign-in off.
          Your company&apos;s Microsoft directory identifier is different: it is company settings,
          not something about you, so it is recorded in the activity trail when an administrator
          switches Microsoft sign-in on, and it appears in the company&apos;s own copy of its data.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Why this is stored</h2>
        <p>
          Solely to run multidisciplinary project coordination for the company whose workspace you
          are in: assigning and tracking work, gating task completion on required documents, keeping
          a dependable audit trail, and notifying people about work relevant to them. Nothing here is
          used for advertising and nothing is ever sold. The only information that leaves this app is
          the chat copy described above, while your administrator has that switched on, the emails
          described above, the question and project details described under Ask Tielora below, while
          your administrator has that switched on, and — if your company pays for a plan — your
          company&apos;s own identifier passed to the payment provider, so they can tell us which
          company paid.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Ask Tielora and AI-written summaries, if your administrator switches them on
        </h2>
        <p>
          Ask Tielora lets someone on your team type a question about their projects and get a short
          written answer. AI-written briefs add two or three sentences, written by AI, to the top of
          the company&apos;s daily and weekly brief, including the copy posted to Slack or Teams.
          Both are off for every company until its
          administrator switches them on, they can be switched off at any time in Admin →
          Integrations, and contractors never see them.
        </p>
        <p>
          <strong>What is sent.</strong> To answer a question, we send the question you typed and the
          names, codes, deadlines, progress figures and task titles of the projects you are on (for
          an administrator, all of the company&apos;s projects). To write a summary, we send the same
          figures the daily brief already shows. They go to Anthropic, which is a{" "}
          <strong>sub-processor</strong>: it handles that text to produce the answer. Its handling is
          governed by its own commercial terms with us rather than by this notice.
        </p>
        <p>
          <strong>What is not sent.</strong> People&apos;s names or email addresses, comments,
          documents or their contents, passwords, sign-in details, or anything from another company.
        </p>
        <p>
          <strong>What Tielora keeps.</strong> Not the question and not the answer: close the panel
          or refresh the page and they are gone. We keep only a running total of how much the company
          has used this month, and a record that a question was asked — who asked and when, never
          what they asked or what came back. That record is part of the permanent audit trail
          described above.
        </p>
        <p>
          <strong>A monthly allowance.</strong> Each company has one, shown in Admin → Billing. When
          it is used up, questions are declined until the next month and briefs go out without the
          written summary.
        </p>
        <p>
          <strong>Please be careful what you type.</strong> Do not put personal or confidential
          information into a question. And <strong>answers can be wrong</strong>: check the task
          before you act on one.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Who else handles information for us
        </h2>
        <p>
          These companies process information on our behalf, each only for the purpose shown:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Anthropic</strong> — writes AI answers and summaries, only if your administrator
            switches them on.
          </li>
          <li>
            <strong>Paddle</strong> — takes payments, only if your company pays for a plan.
          </li>
          <li>
            <strong>Resend</strong> — delivers email, only if your company has email switched on.
          </li>
          <li>
            <strong>Slack and Microsoft</strong> — chat, sign-in and files, only if your company
            connects them.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-[var(--brand-text)]">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Your rights</h2>
        <p>
          You can get a copy of your own information yourself. From the account menu at the top of
          the app, <strong>Your account</strong> lets you download everything Tielora holds about
          you — your profile details, the projects you are on, the tasks assigned to you, the
          comments you wrote, your notifications, your personal list, and the announcements you
          acknowledged or dismissed. It arrives as one file, it contains nothing belonging to your
          company as a whole, and you can download it up to three times a day.
        </p>
        <p>
          Your workspace administrator has the equivalent for the company as a whole, in{" "}
          <strong>Admin → Data &amp; privacy</strong>: a copy of everything the workspace holds, as
          data files plus every uploaded document and revision. It never contains anybody&apos;s
          password, any sign-in session, any one-time email link, anybody&apos;s two-factor secret or
          recovery codes, the personal Microsoft identifier of anybody&apos;s work account (only
          the company&apos;s own Microsoft directory identifier is included), or the address of a connected
          chat channel. That copy is prepared on our server, can be downloaded for one day using a link
          only an administrator of your own company can use, and is deleted from our server two days
          after it was made.
        </p>
        <p>
          You can also delete your own account, from the same <strong>Your account</strong> page.
          Deleting signs you out immediately and removes your name, your email address, your job
          title and your other profile details: your name is replaced with &ldquo;Former
          member&rdquo; everywhere it appears. It does not erase your work. Your comments, the tasks
          you completed and every document revision you uploaded stay where they are, and the audit
          trail keeps the entries it already recorded, including the name they were written with at
          the time — that record is part of your company&apos;s engineering history, not personal
          data held about you alone, and it is the same permanence rule described above. If
          you&apos;re your workspace&apos;s only administrator you&apos;ll need to make someone else
          an administrator first, so your company keeps somebody able to manage it.
        </p>
        <p>
          Your workspace administrator can delete the whole workspace, in{" "}
          <strong>Admin → Data &amp; privacy</strong>. There is a <strong>7-day grace period</strong>{" "}
          first, during which any administrator can cancel it and everything carries on working as
          normal; every administrator is told the moment it is requested. After those 7 days
          everything is removed for good — every account, project, task, comment, document and
          revision, every uploaded file, and the workspace&apos;s whole activity log. It cannot be
          recovered afterwards, so take a copy first if you want one. Requests to correct your
          information, and anything else you would like removed, are handled by{" "}
          <strong>your workspace administrator</strong>.
        </p>
        <p>
          This handling is intended to respect Oman&apos;s Personal Data Protection Law (Royal Decree
          6/2022). If you have a question or concern about how your information is handled, raise it
          with your workspace administrator, who is the contact for your company&apos;s data.
        </p>
        <p>
          Contact the operator:{" "}
          <a
            href={`mailto:${contactEmail}`}
            className="text-[var(--brand-primary)] underline-offset-2 hover:underline"
          >
            {contactEmail}
          </a>
          . This is the person who runs the Tielora service itself, for anything your workspace
          administrator cannot answer.
        </p>
      </section>
    </LegalPage>
  );
}
