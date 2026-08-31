// FilterChips — removable active-filter pills plus a "+ Filter" popover with a checklist per dimension.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type FilterOption = { value: string; label: string; adornment?: ReactNode };
export type FilterDimension = {
  key: string;
  label: string;
  options: FilterOption[];
  /** One value at a time — used where the server route accepts a single value per filter. */
  single?: boolean;
};
export type ActiveFilters = Record<string, string[]>;

function labelFor(dimension: FilterDimension, value: string): string {
  return dimension.options.find((option) => option.value === value)?.label ?? value;
}

export function FilterChips({
  filters,
  active,
  onChange,
}: {
  filters: FilterDimension[];
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle(key: string, value: string) {
    const dimension = filters.find((item) => item.key === key);
    const current = active[key] ?? [];
    const on = current.includes(value);
    const next = dimension?.single
      ? on
        ? []
        : [value]
      : on
        ? current.filter((item) => item !== value)
        : [...current, value];
    onChange({ ...active, [key]: next });
  }

  return (
    <div ref={wrap} className="relative flex flex-wrap items-center gap-2">
      {filters.flatMap((dimension) =>
        (active[dimension.key] ?? []).map((value) => (
          <span
            key={`${dimension.key}:${value}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--brand-text)]"
          >
            {dimension.label}: {labelFor(dimension, value)}
            <button
              type="button"
              onClick={() => toggle(dimension.key, value)}
              aria-label={`Remove filter ${dimension.label}: ${labelFor(dimension, value)}`}
              className="rounded-full px-1 text-[var(--brand-gray)] hover:text-[var(--brand-ink)]"
            >
              ×
            </button>
          </span>
        )),
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="rounded-full border border-dashed border-[var(--brand-gray)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)] hover:border-[var(--brand-primary)]"
      >
        + Filter
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Filters"
          className="absolute left-0 top-full z-30 mt-2 max-h-96 w-72 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 shadow-lg"
        >
          {filters.map((dimension) => (
            <fieldset key={dimension.key} className="mb-3 last:mb-0">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                {dimension.label}
              </legend>
              {dimension.options.length === 0 ? (
                <p className="text-xs text-[var(--brand-gray)]">Nothing to filter by yet.</p>
              ) : (
                dimension.options.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
                  >
                    <input
                      type={dimension.single ? "radio" : "checkbox"}
                      name={dimension.single ? `filter-${dimension.key}` : undefined}
                      checked={(active[dimension.key] ?? []).includes(option.value)}
                      onChange={() => toggle(dimension.key, option.value)}
                      onClick={() => {
                        if (dimension.single && (active[dimension.key] ?? []).includes(option.value)) {
                          toggle(dimension.key, option.value);
                        }
                      }}
                    />
                    {option.adornment}
                    <span>{option.label}</span>
                  </label>
                ))
              )}
            </fieldset>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** True when at least one dimension has a selected value. */
export function hasActiveFilters(active: ActiveFilters): boolean {
  return Object.values(active).some((values) => values.length > 0);
}
