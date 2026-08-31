// Ink sidebar: 240px on large screens, an icon rail between the md and lg breakpoints, and hidden
// altogether on phones — below md the menu button in the top bar opens the same list.
// Admin links only appear for administrators.
//
// On the wide sidebar a row can carry a drop-down of sub-links (My tasks' views, the person's
// starred projects) and there is a Favorites shortcut list of starred *tasks* above Projects —
// starred projects belong to the Projects drop-down alone, so nothing appears twice. On the narrow icon rail
// none of that is shown — there is no room for a label, let alone a list — so the parent icons stay
// plain links. Everything extra is hidden with `hidden lg:...`, which keeps one set of markup for
// both widths.

"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDownIcon } from "@/components/shell/icons";
import {
  childrenFor,
  favoriteShortcuts,
  isCurrentChild,
  isCurrentNav,
  isGroupCurrent,
  navItemsFor,
} from "@/components/shell/nav-items";
import { NavGroupToggle, NavRow, NavSectionLabel } from "@/components/shell/nav-row";
import { readClosedGroups, writeClosedGroups } from "@/components/shell/nav-open-state";
import { favoriteHref, useFavorites } from "@/components/hooks/use-favorites";
import type { RoleName } from "@/lib/zod-schemas";

export function Sidebar({ role }: { role: RoleName }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const items = navItemsFor(role);
  const favorites = useFavorites();
  // Starred tasks only — starred projects live in the Projects drop-down, never in both places.
  const starred = favoriteShortcuts(favorites.data ?? []);

  // Groups the person has folded open or closed by hand this visit. Undefined means "we haven't
  // been told" — that group follows the default: open when the page you are on is inside it.
  const [manual, setManual] = useState<Record<string, boolean>>({});

  // sessionStorage is only read after mounting, so the server and the browser render the same thing.
  useEffect(() => {
    const closed = readClosedGroups();
    if (closed.length > 0) {
      setManual((current) => ({
        ...Object.fromEntries(closed.map((href) => [href, false])),
        ...current,
      }));
    }
  }, []);

  function toggleGroup(href: string, openNow: boolean) {
    setManual((current) => {
      const next = { ...current, [href]: !openNow };
      writeClosedGroups(Object.keys(next).filter((key) => next[key] === false));
      return next;
    });
  }

  return (
    <nav
      aria-label="Main"
      className="hidden w-16 shrink-0 flex-col gap-1 overflow-y-auto bg-[var(--brand-ink)] p-2 md:flex lg:w-60 lg:p-3"
    >
      <div className="mb-4 px-2 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--brand-accent)] lg:hidden">
          TLR
        </p>
        <p className="hidden text-lg font-semibold tracking-tight text-white lg:block">Tielora</p>
      </div>

      {items.map((item) => {
        const children = childrenFor(item, favorites.data ?? []);
        const activeChild = children.find((child) => isCurrentChild(pathname, search, child.href));
        const groupCurrent = isGroupCurrent(pathname, search, item, children);
        const open = manual[item.href] ?? groupCurrent;
        const listId = `nav-group-${item.href.replace(/\W+/g, "-")}`;

        return (
          <div key={item.href}>
            {/* Starred tasks sit directly above Projects on the wide sidebar; starred projects are
                the Projects drop-down below, so nothing is listed twice. */}
            {item.href === "/projects" && starred.length > 0 ? (
              <div className="hidden lg:block">
                <NavSectionLabel>Favorites</NavSectionLabel>
                {starred.map((favorite) => (
                  <NavRow
                    key={favorite.id}
                    href={favoriteHref(favorite)}
                    label={favorite.title}
                    active={isCurrentNav(pathname, favoriteHref(favorite))}
                    subItem
                    dotColor="var(--brand-gray)"
                  />
                ))}
                <div className="mt-3 border-t border-white/10" />
              </div>
            ) : null}

            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <NavRow
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isCurrentNav(pathname, item.href) && !activeChild}
                  collapsed="until-lg"
                />
              </div>
              {children.length > 0 ? (
                <span className="hidden lg:inline-flex">
                  <NavGroupToggle
                    label={item.label}
                    open={open}
                    controls={listId}
                    onToggle={() => toggleGroup(item.href, open)}
                  >
                    <ChevronDownIcon />
                  </NavGroupToggle>
                </span>
              ) : null}
            </div>

            {children.length > 0 && open ? (
              <div id={listId} className="hidden lg:block">
                {children.map((child) => (
                  <NavRow
                    key={child.href}
                    href={child.href}
                    label={child.label}
                    active={isCurrentChild(pathname, search, child.href)}
                    subItem
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
