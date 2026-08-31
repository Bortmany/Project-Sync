// Tabs — a simple controlled/uncontrolled tab strip used by the task detail screens.

"use client";

import { useState, type ReactNode } from "react";

export type TabItem = { id: string; label: string; content: ReactNode };

export function Tabs({
  items,
  initialId,
  onChange,
}: {
  items: TabItem[];
  initialId?: string;
  onChange?: (id: string) => void;
}) {
  const [active, setActive] = useState(initialId ?? items[0]?.id ?? "");
  const current = items.find((item) => item.id === active) ?? items[0];

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto border-b border-[var(--border)]"
      >
        {items.map((item) => {
          const selected = item.id === current?.id;
          return (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => {
                setActive(item.id);
                onChange?.(item.id);
              }}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                selected
                  ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                  : "border-transparent text-[var(--brand-text)] hover:text-[var(--brand-ink)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="min-w-0 pt-4">
        {current?.content}
      </div>
    </div>
  );
}
