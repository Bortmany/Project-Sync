// Create a workspace: the public sign-up screen, beside sign-in in the same split-hero layout.
//
// The template cards come from ./template-cards, which reads the real discipline lists in
// src/server/industry-templates.ts — the same lists signup seeds — so what a card promises and what
// a new company actually gets can never drift apart. The form itself is a client component.
//
// Whether the door is open, invite-only or closed is read on the server from src/lib/signup-mode.ts
// — the same function the route uses — so the screen never promises what the route refuses. The
// codes themselves never reach the browser; only the mode does.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SIGNUP_CLOSED_MESSAGE, signupMode } from "@/lib/signup-mode";
import { AuthLegalLinks, AuthSplit } from "../auth-split";
import { SignupForm } from "./signup-form";
import { SIGNUP_TEMPLATE_CARDS } from "./template-cards";

export const metadata = { title: "Create a workspace — Tielora" };

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const mode = signupMode();

  const signInLine = (
    <p className="mt-6 text-sm text-[var(--brand-text)]">
      Already have a workspace?{" "}
      <Link
        href="/login"
        className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
      >
        Sign in.
      </Link>
    </p>
  );

  if (mode === "closed") {
    return (
      <AuthSplit>
        <h2 className="text-xl font-semibold text-[var(--brand-ink)]">{SIGNUP_CLOSED_MESSAGE}</h2>
        <p className="mt-2 text-sm text-[var(--brand-text)]">
          New workspaces are not being created at the moment. If your company already uses Tielora,
          ask your administrator to add you and sign in with the details they give you.
        </p>
        {signInLine}
        <AuthLegalLinks />
      </AuthSplit>
    );
  }

  return (
    <AuthSplit wide>
      <SignupForm templates={SIGNUP_TEMPLATE_CARDS} inviteRequired={mode === "invite"} />
      {signInLine}
      <AuthLegalLinks />
    </AuthSplit>
  );
}
