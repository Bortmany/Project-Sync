// UserPicker — type-ahead search over the organisation's people. One person per picker.

"use client";

import { useEffect, useRef, useState } from "react";
import { useUsers } from "@/components/hooks/use-api";
import { Avatar, Input, Skeleton } from "@/components/ui";
import type { RoleName } from "@/lib/zod-schemas";

// The role and discipline travel with the person because who they ARE decides what they may be
// added as: an external contractor joins a project as a contractor, in their own discipline, and
// nothing else (upsertMember refuses anything else, so the form must not offer it).
export type PickedUser = {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  disciplineId: string | null;
};

export function UserPicker({
  value,
  onChange,
  placeholder = "Search people…",
  label,
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  placeholder?: string;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const people = useUsers(query, open);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (value) {
    return (
      <div className="flex min-h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-1">
        <Avatar name={value.name} size={24} />
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--brand-ink)]">
          {value.name}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Remove ${value.name}`}
          className="rounded px-1 text-[var(--brand-gray)] hover:text-[var(--brand-ink)]"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={wrap} className="relative">
      <Input
        aria-label={label ?? "Search people"}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-white p-1 shadow-lg">
          {people.isPending ? (
            <div className="space-y-1 p-1">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : people.isError ? (
            <p className="p-2 text-xs text-[var(--status-blocked)]">
              Couldn&apos;t load people. Try again.
            </p>
          ) : (people.data ?? []).length === 0 ? (
            <p className="p-2 text-xs text-[var(--brand-gray)]">No one matches that search.</p>
          ) : (
            (people.data ?? []).map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => {
                  onChange({
                    id: person.id,
                    name: person.name,
                    email: person.email,
                    role: person.role,
                    disciplineId: person.disciplineId,
                  });
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--page-bg)]"
              >
                <Avatar name={person.name} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--brand-ink)]">
                    {person.name}
                  </span>
                  <span className="block truncate text-xs text-[var(--brand-gray)]">
                    {person.email}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
