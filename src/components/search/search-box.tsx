// The topbar search: type, wait a moment, and a grouped dropdown of the best few hits appears.
// Arrow keys move the highlight, Enter opens it, Esc closes. ⌘K / Ctrl+K jumps into the box.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/shell/icons";
import { GROUP_LABEL, GROUP_ORDER, allRows, rowsFor } from "@/components/search/search-model";
import { MIN_SEARCH_LENGTH, countResults, useSearch } from "@/components/hooks/use-api";
import { Skeleton } from "@/components/ui";

/** Rows per group in the dropdown — the full page shows the rest. */
const PER_GROUP = 3;
const DEBOUNCE_MS = 250;

export function SearchBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Debounce: only the pause in typing reaches the server.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useSearch(query);
  const rows = allRows(search.data, PER_GROUP);
  const total = countResults(search.data);
  const ready = query.trim().length >= MIN_SEARCH_LENGTH;

  useEffect(() => setHighlight(0), [query]);

  // ⌘K / Ctrl+K from anywhere in the app puts the cursor in the box.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Clicking anywhere else closes the dropdown.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(href: string, external?: boolean) {
    setOpen(false);
    if (external) window.location.href = href;
    else router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[highlight];
      if (row) go(row.href, row.external);
      else if (text.trim()) {
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(text.trim())}`);
      }
    }
  }

  let position = -1;

  return (
    <div ref={boxRef} className="relative flex-1 max-w-xl">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-gray)]">
        <SearchIcon />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search projects, tasks, documents, people…"
        aria-label="Search"
        aria-expanded={open}
        aria-controls="search-results"
        role="combobox"
        aria-autocomplete="list"
        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] py-2 pl-9 pr-14 text-sm text-[var(--brand-text)] placeholder:text-[var(--brand-gray)] focus:border-[var(--brand-primary)] focus:outline-none"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--brand-gray)]">
        ⌘K
      </span>

      {open && ready ? (
        <div
          id="search-results"
          role="listbox"
          className="absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 shadow-lg"
        >
          {search.isError ? (
            <div className="px-2 py-3 text-sm text-[var(--status-blocked)]">
              Couldn&apos;t complete the search.{" "}
              <button
                type="button"
                onClick={() => void search.refetch()}
                className="font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : search.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : total === 0 ? (
            <p className="px-2 py-3 text-sm text-[var(--brand-text)]">
              No results for “{query.trim()}”. Try a different name, code, or keyword.
            </p>
          ) : (
            <>
              {GROUP_ORDER.map((group) => {
                const groupRows = search.data
                  ? rowsFor(search.data, group).slice(0, PER_GROUP)
                  : [];
                if (groupRows.length === 0) return null;
                return (
                  <section key={group} className="mb-1">
                    <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                      {GROUP_LABEL[group]}
                    </h3>
                    {groupRows.map((row) => {
                      position += 1;
                      const index = position;
                      const active = index === highlight;
                      return (
                        <button
                          key={row.key}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => go(row.href, row.external)}
                          className={`flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-2 text-left text-sm ${
                            active ? "bg-[var(--page-bg)]" : ""
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--brand-ink)]">
                            {row.title}
                          </span>
                          <span className="shrink-0 truncate text-xs text-[var(--brand-gray)]">
                            {row.meta}
                          </span>
                        </button>
                      );
                    })}
                  </section>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/search?q=${encodeURIComponent(query.trim())}`);
                }}
                className="w-full rounded-[var(--radius)] px-2 py-2 text-left text-sm font-semibold text-[var(--brand-primary)] hover:bg-[var(--page-bg)]"
              >
                View all {total} {total === 1 ? "result" : "results"} →
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
