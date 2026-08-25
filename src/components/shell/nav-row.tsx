// One navigation row, in every place a navigation row appears: the desktop sidebar, the icon-only
// rail between md and lg, and the phone slide-over. The markup lives here once so the three can
// never drift apart.

"use client";

import Link from "next/link";
import type { ReactNode } from "react";

const BASE = "flex items-center gap-3 rounded-[var(--radius)] border-l-2 transition-colors";

/** The active treatment: sail-blue left edge on the lighter navy, exactly as before. */
const ACTIVE = "border-[var(--olng-sail)] bg-[var(--olng-mid)] text-white";
const IDLE = "border-transparent text-white/75 hover:bg-[var(--olng-mid)] hover:text-white";

export type NavRowProps = {
  href: string;
  label: string;
  active: boolean;
  /** The row's icon. Left out on sub-items, which show a small dot instead. */
  icon?: React.ComponentType<{ size?: number }>;
  /**
   * Icon-only rail: the label is hidden from sight but stays for screen readers. "until-lg" is the
   * sidebar's case — the same row is a rail icon at md and a full row at lg.
   */
  collapsed?: "always" | "until-lg" | false;
  /** A child of a group: smaller, indented, no icon. */
  subItem?: boolean;
  /** A coloured dot in place of the icon — used by the favorites list. */
  dotColor?: string;
  /** Roomier tap target, used in the phone menu. */
  touch?: boolean;
  onClick?: () => void;
  /** Anything shown at the end of the row, such as a project code. */
  trailing?: ReactNode;
};

export function NavRow({
  href,
  label,
  active,
  icon: Icon,
  collapsed = false,
  subItem = false,
  dotColor,
  touch = false,
  onClick,
  trailing,
}: NavRowProps) {
  const size = subItem ? "py-1.5 pl-7 pr-3 text-[13px]" : "py-2 px-3 text-sm";
  const labelClass =
    collapsed === "always"
      ? "sr-only"
      : collapsed === "until-lg"
        ? "sr-only lg:not-sr-only lg:min-w-0 lg:flex-1 lg:truncate"
        : "min-w-0 flex-1 truncate";

  return (
    <Link
      href={href}
      title={label}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`${BASE} ${size} ${touch ? "min-h-11" : ""} ${active ? ACTIVE : IDLE}`}
    >
      {Icon ? <Icon size={18} /> : null}
      {!Icon && subItem ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor ?? "var(--olng-sail)" }}
        />
      ) : null}
      <span className={labelClass}>{label}</span>
      {trailing ?? null}
    </Link>
  );
}

/** The chevron button that opens and closes a group of sub-items. */
export function NavGroupToggle({
  label,
  open,
  controls,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  /** The id of the list this button shows and hides. */
  controls: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? `Hide ${label} links` : `Show ${label} links`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] text-white/60 transition-colors hover:bg-[var(--olng-mid)] hover:text-white"
    >
      <span className={`transition-transform ${open ? "rotate-0" : "-rotate-90"}`}>{children}</span>
    </button>
  );
}

/** The tiny uppercase heading above a sidebar section, such as FAVORITES. */
export function NavSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
      {children}
    </p>
  );
}
