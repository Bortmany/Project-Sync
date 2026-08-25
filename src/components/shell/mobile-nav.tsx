// Phone navigation: a menu button in the top bar that slides the same navy nav list in from the
// left. Only shown below the md breakpoint — from md up the sidebar rail is back and this is gone.
//
// The overlay is roomy, so groups are simply shown open: no chevrons to press, every destination
// visible at once. The rows themselves are the shared NavRow, so the phone menu and the sidebar can
// never look different.

"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CloseIcon, MenuIcon } from "@/components/shell/icons";
import {
  childrenFor,
  favoriteShortcuts,
  isCurrentChild,
  isCurrentNav,
  navItemsFor,
} from "@/components/shell/nav-items";
import { NavRow, NavSectionLabel } from "@/components/shell/nav-row";
import { favoriteHref, useFavorites } from "@/components/hooks/use-favorites";
import type { RoleName } from "@/lib/zod-schemas";

export function MobileNav({ role }: { role: RoleName }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const items = navItemsFor(role);
  const favorites = useFavorites();
  // Starred tasks only — starred projects are the Projects drop-down, exactly as on the sidebar.
  const starred = favoriteShortcuts(favorites.data ?? []);

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
            className="flex h-full w-64 max-w-[80vw] flex-col gap-1 overflow-y-auto bg-[var(--olng-navy)] p-3"
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
              const children = childrenFor(item, favorites.data ?? []);
              const activeChild = children.find((child) =>
                isCurrentChild(pathname, search, child.href),
              );

              return (
                <div key={item.href}>
                  {item.href === "/projects" && starred.length > 0 ? (
                    <div className="mb-2">
                      <NavSectionLabel>Favorites</NavSectionLabel>
                      {starred.map((favorite) => (
                        <NavRow
                          key={favorite.id}
                          href={favoriteHref(favorite)}
                          label={favorite.title}
                          active={isCurrentNav(pathname, favoriteHref(favorite))}
                          subItem
                          touch
                          dotColor="var(--olng-gray)"
                          onClick={() => setOpen(false)}
                        />
                      ))}
                      <div className="mt-3 border-t border-white/10" />
                    </div>
                  ) : null}

                  <NavRow
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isCurrentNav(pathname, item.href) && !activeChild}
                    touch
                    onClick={() => setOpen(false)}
                  />

                  {children.map((child) => (
                    <NavRow
                      key={child.href}
                      href={child.href}
                      label={child.label}
                      active={isCurrentChild(pathname, search, child.href)}
                      subItem
                      touch
                      onClick={() => setOpen(false)}
                    />
                  ))}
                </div>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
