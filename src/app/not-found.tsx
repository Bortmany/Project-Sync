// Page-not-found outside the signed-in shell (a bad link typed straight into the address bar).

import Link from "next/link";

export const metadata = { title: "Page not found — Project Nexus" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold text-[var(--olng-blue)]">Page not found</h1>
        <p className="text-sm text-[var(--olng-text)]">
          We couldn&apos;t find that page. It may have been removed, or the link may be out of date.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--olng-blue)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--olng-mid)]"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
