// Top bar: search placeholder, notification bell placeholder, and the user menu with sign out.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui";
import { BellIcon, SearchIcon } from "@/components/shell/icons";

export function Topbar({ name, email }: { name: string; email: string }) {
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
    <header className="flex h-14 items-center gap-4 border-b border-[var(--border)] bg-white px-4">
      <div className="relative flex-1 max-w-xl">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--olng-gray)]">
          <SearchIcon />
        </span>
        <input
          type="search"
          disabled
          placeholder="Search projects, tasks and documents (coming soon)"
          aria-label="Search"
          className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] py-2 pl-9 pr-3 text-sm text-[var(--olng-text)] placeholder:text-[var(--olng-gray)]"
        />
      </div>

      <button
        type="button"
        disabled
        title="Notifications (coming soon)"
        aria-label="Notifications"
        className="rounded-[var(--radius)] p-2 text-[var(--olng-gray)]"
      >
        <BellIcon />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-[var(--radius)] p-1 hover:bg-[var(--page-bg)]"
        >
          <Avatar name={name} />
          <span className="hidden text-sm text-[var(--olng-text)] sm:inline">{name}</span>
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 shadow-lg"
          >
            <p className="px-2 py-1 text-xs text-[var(--olng-gray)]">{email}</p>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={signingOut}
              className="w-full rounded-[var(--radius)] px-2 py-2 text-left text-sm text-[var(--olng-text)] hover:bg-[var(--page-bg)]"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
