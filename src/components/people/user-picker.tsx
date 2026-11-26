// UserPicker — type-ahead search over the organisation's people. One person per picker.

"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
  clearable = true,
  searchRef,
  unavailable,
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  placeholder?: string;
  label?: string;
  /**
   * Whether the picked person carries their own × to clear them. Off where the row around the
   * picker already has one remove button (New project's people step), so there is one × per row.
   */
  clearable?: boolean;
  /**
   * The search box, for a dialog that starts with the cursor in it (Add a member hands this to
   * `Modal`'s `initialFocusRef`). Used as the box's own ref when given.
   */
  searchRef?: RefObject<HTMLInputElement | null>;
  /**
   * People who are listed but cannot be picked, each with the short reason shown under their name
   * (Add a member: "Already on this project"). They stay in the results, so a search for them does
   * not answer "No one matches", but pressing them does nothing.
   */
  unavailable?: ReadonlyMap<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const people = useUsers(query, open);

  // Picking a person swaps the search (and the list item that was pressed) for the picked person,
  // and clearing them swaps it back — either way the element that had focus is gone, and a keyboard
  // user was left on the page with the next Tab landing on the dialog's Close button. Focus goes to
  // the picked person (so Tab carries on to the next box) or back into the search. Applied in an
  // effect keyed on this value alone, once the swap is on the page.
  const chip = useRef<HTMLDivElement>(null);
  const ownSearch = useRef<HTMLInputElement>(null);
  const search = searchRef ?? ownSearch;
  const [focusAfterSwap, setFocusAfterSwap] = useState<"picked" | "search" | null>(null);

  useEffect(() => {
    if (focusAfterSwap === null) return;
    (focusAfterSwap === "picked" ? chip.current : search.current)?.focus();
    setFocusAfterSwap(null);
    // `search` is a ref object (the dialog's own, or this picker's), the same one for the picker's
    // whole life, so listing it never re-runs this effect while someone types.
  }, [focusAfterSwap, search]);

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
      <div
        ref={chip}
        // Not a Tab stop of its own: it only holds focus after a pick, so the next Tab moves on.
        tabIndex={-1}
        role="group"
        aria-label={`${label ?? "Person"}: ${value.name}`}
        className="flex min-h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-1 focus:border-[var(--brand-primary)] focus:outline-none"
      >
        <Avatar name={value.name} size={24} />
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--brand-ink)]">
          {value.name}
        </span>
        {clearable ? (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setFocusAfterSwap("search");
            }}
            aria-label={`Remove ${value.name}`}
            className="rounded px-1 text-[var(--brand-gray)] hover:text-[var(--brand-ink)]"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      className="relative"
      // The list closes once focus leaves the search and its list (Tab onwards, Shift+Tab back), so
      // it never sits over the hints and buttons below it. Moving between the box and a person in
      // the list keeps it open; what was typed stays, and focusing the box again reopens the list.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOpen(false);
      }}
    >
      <Input
        ref={search}
        aria-label={label ?? "Search people"}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Escape belongs to the search first: it closes the list and clears what was typed. Only
          // an Escape with nothing left to close here goes on to close the dialog around it.
          if (!open && query === "") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setQuery("");
        }}
      />
      {open ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-white p-1 shadow-lg"
          // Pressing in the list (a person, its scroll bar) leaves focus in the box, so the list is
          // not closed by the box losing focus before the press lands. Safari never focuses a
          // pressed button at all, which would otherwise close the list on every pick.
          onMouseDown={(event) => event.preventDefault()}
        >
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
            (people.data ?? []).map((person) => {
              const reason = unavailable?.get(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={reason !== undefined}
                  onClick={() => {
                    if (reason !== undefined) return;
                    onChange({
                      id: person.id,
                      name: person.name,
                      email: person.email,
                      role: person.role,
                      disciplineId: person.disciplineId,
                    });
                    setQuery("");
                    setOpen(false);
                    setFocusAfterSwap("picked");
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--page-bg)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
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
                  {reason !== undefined ? (
                    <span className="shrink-0 text-xs font-semibold text-[var(--brand-gray)]">
                      {reason}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
