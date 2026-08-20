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
    <div>
      <div role="tablist" className="flex gap-1 border-b border-[var(--border)]">
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
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                selected
                  ? "border-[var(--olng-blue)] text-[var(--olng-blue)]"
                  : "border-transparent text-[var(--olng-text)] hover:text-[var(--olng-navy)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-4">
        {current?.content}
      </div>
    </div>
  );
}
