// Modal — a focus-trapping dialog built on the browser's own <dialog> behaviour, no library needed.

"use client";

import { useEffect, useRef, type ReactNode } from "react";

const SIZE_CLASS = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl" } as const;

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZE_CLASS;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--brand-ink)]/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${SIZE_CLASS[size]} overflow-y-auto rounded-[var(--radius)] bg-white shadow-lg focus:outline-none`}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--brand-ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </header>
        <div className="px-4 py-4 text-sm text-[var(--brand-text)]">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
