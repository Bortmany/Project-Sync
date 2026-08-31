// Top bar: global search, the notification bell, and the user menu with sign out.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui";
import { SearchBox } from "@/components/search/search-box";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { MobileNav } from "@/components/shell/mobile-nav";
import type { RoleName } from "@/lib/zod-schemas";

export function Topbar({ name, email, role }: { name: string; email: string; role: RoleName }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center gap-2 border-b border-[var(--border)] bg-white px-2 sm:gap-4 sm:px-4">
      <MobileNav role={role} />

      <SearchBox />

      <NotificationBell />

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-[var(--radius)] p-1 hover:bg-[var(--page-bg)]"
        >
          <Avatar name={name} />
          <span className="hidden text-sm text-[var(--brand-text)] sm:inline">{name}</span>
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 shadow-lg"
          >
            <p className="px-2 py-1 text-xs text-[var(--brand-gray)]">{email}</p>
            {/* Everybody has one, contractors included: it is about their own data, not the
                company's. The workspace-wide equivalent lives in Admin → Data & privacy. */}
            <Link
              href="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius)] px-2 py-2 text-left text-sm text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
            >
              Your account
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={signingOut}
              className="w-full rounded-[var(--radius)] px-2 py-2 text-left text-sm text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
