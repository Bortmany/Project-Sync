// "Yes, this is my address." The shortest page in the app: it spends the verification link and
// says so, and that is all it does.
//
// Verification is a nudge, never a lock — nothing anywhere in Tielora is withheld from somebody who
// has not verified — so this page grants no access and changes nothing else. A link that is wrong,
// expired or already used gets the same one paragraph every other emailed link gets.

import Link from "next/link";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { byIp, limit } from "@/lib/rate-limit";
import { EmailTokenSchema } from "@/lib/zod-schemas";
import { homePathFor } from "@/components/shell/nav-items";
import { verifyEmailWithToken } from "@/server/services/account";
import { AuthLegalLinks, AuthSplit, BackToSignIn } from "../auth-split";

export const metadata = { title: "Verify your email — Tielora" };
export const dynamic = "force-dynamic";

/** Attempts per IP address per hour. A person needs one; guessing needs rather more. */
const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 60 * 60 * 1000;

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [params, user, requestHeaders] = await Promise.all([
    searchParams,
    getSessionUser(),
    headers(),
  ]);

  // The same key shape every anonymous route uses, built from the incoming headers because a page
  // is handed no Request of its own.
  const key = byIp(new Request("https://tielora.local/verify-email", { headers: requestHeaders }), "verify-email");
  const throttle = limit(key, VERIFY_LIMIT, VERIFY_WINDOW_MS);

  const parsed = EmailTokenSchema.safeParse(params.token ?? "");
  const verified =
    throttle.ok && parsed.success ? await verifyEmailWithToken({ token: parsed.data }) : false;

  const onwards = user
    ? { href: homePathFor(user.role), label: "Go to Tielora" }
    : { href: "/login", label: "Sign in" };

  return (
    <AuthSplit>
      {verified ? (
        <>
          <h2 className="text-xl font-semibold text-[var(--brand-ink)]">Your email is verified</h2>
          <p className="mt-1 text-sm text-[var(--brand-text)]">
            Thank you — that is everything we needed.
          </p>
          <p className="mt-6">
            <Link
              href={onwards.href}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-mid)]"
            >
              {onwards.label}
            </Link>
          </p>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-[var(--brand-ink)]">This link no longer works</h2>
          <p className="mt-1 text-sm text-[var(--brand-text)]">
            It may have expired or already been used. Sign in and use &ldquo;Resend verification
            email&rdquo; to get a new one.
          </p>
          <BackToSignIn />
        </>
      )}
      <AuthLegalLinks />
    </AuthSplit>
  );
}
