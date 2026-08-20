// Error screen for the signed-in area — keeps the shell and offers one clear way forward.

"use client";

import { Button, Card } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card title="Something went wrong">
      <p className="text-sm text-[var(--olng-text)]">
        We could not load this page. Nothing you were working on has been lost. Please try again, and
        tell your administrator if it keeps happening.
      </p>
      <div className="mt-4">
        <Button onClick={reset}>Try again</Button>
      </div>
    </Card>
  );
}
