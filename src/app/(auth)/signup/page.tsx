// Create a workspace: the public sign-up screen, beside sign-in in the same split-hero layout.
//
// The template cards come from ./template-cards, which reads the real discipline lists in
// src/server/industry-templates.ts — the same lists signup seeds — so what a card promises and what
// a new company actually gets can never drift apart. The form itself is a client component.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AuthLegalLinks, AuthSplit } from "../auth-split";
import { SignupForm } from "./signup-form";
import { SIGNUP_TEMPLATE_CARDS } from "./template-cards";

export const metadata = { title: "Create a workspace — Tielora" };

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <AuthSplit wide>
      <SignupForm templates={SIGNUP_TEMPLATE_CARDS} />
      <p className="mt-6 text-sm text-[var(--brand-text)]">
        Already have a workspace?{" "}
        <Link
          href="/login"
          className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
        >
          Sign in.
        </Link>
      </p>
      <AuthLegalLinks />
    </AuthSplit>
  );
}
