// Error screen for the signed-in area — keeps the shell and offers one clear way forward.

"use client";

import { useEffect } from "react";
import { Button, Card } from "@/components/ui";
import { reportClientError } from "@/lib/report-client-error";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

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
