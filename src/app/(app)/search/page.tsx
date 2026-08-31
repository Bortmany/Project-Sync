// Search — the full results page for whatever was typed in the topbar (or arrived as ?q=).

import { Suspense } from "react";
import { SearchResultsView } from "@/components/search/search-results-view";
import { SkeletonRows } from "@/components/ui";

export const metadata = { title: "Search — Tielora" };

export default function SearchPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <SearchResultsView />
    </Suspense>
  );
}
