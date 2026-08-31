// Breadcrumb — the trail above nested screens. The last item is the current page and never a link.

import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-[var(--brand-gray)]">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="text-[var(--brand-primary)] hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "text-[var(--brand-text)]" : undefined}>{item.label}</span>
              )}
              {last ? null : <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
