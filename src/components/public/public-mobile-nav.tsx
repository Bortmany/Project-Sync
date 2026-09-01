// The phone menu on the public pages — THE ONLY CLIENT COMPONENT in the public shell.
//
// The mechanics are a direct copy of src/components/shell/mobile-nav.tsx (open state, Escape
// closes, moving to another page closes it, a dimmed backdrop over a full-height ink panel), with
// the signed-in nav list replaced by the four things a visitor has. It slides in from the right,
// mirrored from the signed-in menu: there is no sidebar out here to line up with.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CloseIcon, MenuIcon } from "@/components/shell/icons";
import { LinkButton } from "@/components/public/link-button";

/** One row of the menu, sized for a thumb — the same `min-h-11` the signed-in NavRow uses. */
function MenuLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex min-h-12 items-center rounded-[var(--radius)] border-l-2 border-transparent px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-[var(--brand-mid)] hover:text-white"
    >
      {label}
    </Link>
  );
}

export function PublicMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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

  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] text-[var(--brand-ink)] hover:bg-[var(--page-bg)]"
      >
        <MenuIcon />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[var(--brand-ink)]/40"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <nav
            aria-label="Main"
            className="flex h-full w-64 max-w-[80vw] flex-col gap-1 overflow-y-auto bg-[var(--brand-ink)] p-3"
          >
            <div className="mb-4 flex items-start justify-between gap-2 px-2 py-2">
              <p className="text-lg font-semibold tracking-tight text-white">Tielora</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close the menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] text-white/80 hover:bg-[var(--brand-mid)] hover:text-white"
              >
                <CloseIcon />
              </button>
            </div>

            <MenuLink href="/#features" label="Features" onClick={close} />
            <MenuLink href="/pricing" label="Pricing" onClick={close} />

            <div className="my-3 border-t border-white/10" />

            <MenuLink href="/login" label="Sign in" onClick={close} />

            <div className="mt-2 px-1">
              <LinkButton href="/signup" full>
                Get started
              </LinkButton>
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
