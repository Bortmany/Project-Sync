// Navy sidebar: 240px on large screens, an icon rail between the md and lg breakpoints, and hidden
// altogether on phones — below md the menu button in the top bar opens the same list.
// Admin links only appear for administrators.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentNav, navItemsFor } from "@/components/shell/nav-items";
import type { RoleName } from "@/lib/zod-schemas";

export function Sidebar({ role }: { role: RoleName }) {
  const pathname = usePathname();
  const items = navItemsFor(role);

  return (
    <nav
      aria-label="Main"
      className="hidden w-16 shrink-0 flex-col gap-1 bg-[var(--olng-navy)] p-2 md:flex lg:w-60 lg:p-3"
    >
      <div className="mb-4 px-2 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--olng-sail)]">
          <span className="hidden lg:inline">Oman LNG</span>
          <span className="lg:hidden">OLNG</span>
        </p>
        <p className="hidden text-lg font-semibold text-white lg:block">Project Nexus</p>
      </div>

      {items.map((item) => {
        const active = isCurrentNav(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors ${
              active
                ? "border-l-2 border-[var(--olng-sail)] bg-[var(--olng-mid)] text-white"
                : "border-l-2 border-transparent text-white/75 hover:bg-[var(--olng-mid)] hover:text-white"
            }`}
          >
            <Icon size={18} />
            <span className="hidden lg:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
