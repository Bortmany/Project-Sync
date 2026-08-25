// Login screen: navy sail-motif hero on the left, the sign-in form on the right. Accounts are created by an admin.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SailMotif } from "@/components/ui/sail-motif";
import { LoginForm } from "./login-form";
import { LoginHero } from "./login-hero";

export const metadata = { title: "Sign in — Project Nexus" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      <section
        className="relative flex min-h-48 flex-col justify-end overflow-hidden p-8 md:min-h-screen md:w-[45%]"
        style={{
          background: "linear-gradient(150deg, var(--olng-navy) 0%, var(--olng-mid) 100%)",
        }}
      >
        <SailMotif className="pointer-events-none absolute inset-0 h-full w-full" />
        <LoginHero />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--olng-sail)]">
            Oman LNG
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-white">Project Nexus</h1>
          <p className="mt-3 max-w-sm text-sm text-white/80">
            Multidisciplinary coordination for engineering teams
          </p>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold text-[var(--olng-navy)]">Sign in</h2>
          <p className="mt-1 text-sm text-[var(--olng-text)]">
            Use your Oman LNG work email. Accounts are set up by an administrator.
          </p>
          <div className="mt-6">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
