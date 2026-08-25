// The full search page: the same results as the topbar dropdown, grouped and complete.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { GROUP_LABEL, GROUP_ORDER, rowsFor, type SearchRow } from "@/components/search/search-model";
import { MIN_SEARCH_LENGTH, countResults, useSearch } from "@/components/hooks/use-api";
import { EmptyState, ErrorBanner, Input, SkeletonRows } from "@/components/ui";

/** Rows shown per group before "Show more". */
const VISIBLE_PER_GROUP = 5;
const DEBOUNCE_MS = 250;

function Row({ row }: { row: SearchRow }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--olng-navy)]">
        {row.title}
      </span>
      <span className="shrink-0 text-xs text-[var(--olng-gray)]">{row.meta}</span>
    </>
  );

  const className =
    "flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-3 py-2 hover:bg-[var(--page-bg)]";

  if (row.external) {
    return (
      <a href={row.href} className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={row.href} className={className}>
      {body}
    </Link>
  );
}

function Group({ rows, label }: { rows: SearchRow[]; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, VISIBLE_PER_GROUP);
  const hidden = rows.length - shown.length;

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-2">
      <h2 className="px-3 py-1 text-sm font-semibold text-[var(--olng-navy)]">
        {label} ({rows.length})
      </h2>
      <div className="divide-y divide-[var(--border)]">
        {shown.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-3 py-2 text-xs font-semibold text-[var(--olng-blue)] underline underline-offset-2"
        >
          Show more ({hidden})
        </button>
      ) : null}
    </section>
  );
}

export function SearchResultsView() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState(initial);

  // Keep the box in step with the address bar when someone arrives from the topbar.
  useEffect(() => {
    setText(initial);
    setQuery(initial);
  }, [initial]);

  // Typing here searches live and keeps the address bar shareable.
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = text.trim();
      setQuery(trimmed);
      if (trimmed !== initial) {
        router.replace(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `initial` is intentionally left out: it changes as a result of the replace above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, router]);

  const search = useSearch(query);
  const total = countResults(search.data);
  const ready = query.trim().length >= MIN_SEARCH_LENGTH;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[var(--olng-blue)]">Search</h1>

      <Input
        type="search"
        value={text}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        placeholder="Search projects, tasks, documents, people…"
        aria-label="Search"
        className="max-w-xl"
      />

      {!ready ? (
        <p className="py-8 text-center text-sm text-[var(--olng-text)]">
          Type to search projects, tasks, documents, and people.
        </p>
      ) : search.isError ? (
        <ErrorBanner
          message="Couldn't complete the search. Try again."
          onRetry={() => void search.refetch()}
        />
      ) : search.isPending ? (
        <SkeletonRows rows={8} />
      ) : total === 0 ? (
        <EmptyState
          message={`No results for “${query.trim()}”. Try a different name, code, or keyword.`}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--olng-gray)]">
            {total} {total === 1 ? "result" : "results"} for “{query.trim()}”
          </p>
          {GROUP_ORDER.map((group) => {
            const rows = search.data ? rowsFor(search.data, group) : [];
            if (rows.length === 0) return null;
            return <Group key={group} label={GROUP_LABEL[group]} rows={rows} />;
          })}
        </div>
      )}
    </div>
  );
}
