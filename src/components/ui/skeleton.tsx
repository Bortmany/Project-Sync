// Skeleton — gray shimmer blocks shaped like the real content, never a bare spinner for lists.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-[var(--brand-gray)]/30 ${className}`}
    />
  );
}

/** A stack of full-width skeleton rows, sized like a 44px table/list row. */
export function SkeletonRows({ rows = 6, height = "h-9" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={`w-full ${height}`} />
      ))}
    </div>
  );
}
