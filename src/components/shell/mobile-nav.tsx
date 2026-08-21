// Phone navigation: a menu button in the top bar that slides the same navy nav list in from the
// left. Only shown below the md breakpoint — from md up the sidebar rail is back and this is gone.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CloseIcon, MenuIcon } from "@/components/shell/icons";
import { isCurrentNav, navItemsFor } from "@/components/shell/nav-items";
import type { RoleName } from "@/lib/zod-schemas";

export function MobileNav({ role }: { role: RoleName }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navItemsFor(role);

  // Moving to another page closes the menu behind you.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] text-[var(--olng-navy)] hover:bg-[var(--page-bg)]"
      >
        <MenuIcon />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-[var(--olng-navy)]/40"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <nav
            aria-label="Main"
            className="flex h-full w-64 max-w-[80vw] flex-col gap-1 bg-[var(--olng-navy)] p-3"
          >
            <div className="mb-4 flex items-start justify-between gap-2 px-2 py-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--olng-sail)]">
                  Oman LNG
                </p>
                <p className="text-lg font-semibold text-white">Project Nexus</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] text-white/80 hover:bg-[var(--olng-mid)] hover:text-white"
              >
                <CloseIcon />
              </button>
            </div>

            {items.map((item) => {
              const active = isCurrentNav(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors ${
                    active
                      ? "border-l-2 border-[var(--olng-sail)] bg-[var(--olng-mid)] text-white"
                      : "border-l-2 border-transparent text-white/75 hover:bg-[var(--olng-mid)] hover:text-white"
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
