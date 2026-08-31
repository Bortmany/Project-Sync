// The strip that sits above everything else while a workspace is counting down to deletion.
//
// It is the VerificationBanner's structure with two deliberate differences:
//  - **The danger tone**, not the calm accent one — this is the only banner in the app that is
//    about permanent data loss.
//  - **No dismiss button.** A soft nudge earns an ✕; a live countdown to everything being deleted
//    does not. It stays on every page until an administrator cancels it or the seven days run out.
//
// Only administrators are ever sent this component (the layout decides): everybody else is affected
// too, but has no button to press, and a countdown nobody can act on is anxiety rather than news.
// Cancelling from here asks for no second confirmation — undoing a dangerous thing is exactly where
// friction should be lowest.

"use client";

import { useRouter } from "next/navigation";
import { cancelWorkspaceDeletion } from "@/components/actions";
import { formatDate } from "@/components/format";
import { useAction } from "@/components/hooks/use-action";

export function DeletionBanner({ deletesOn }: { deletesOn: Date }) {
  const router = useRouter();
  const { run, pending } = useAction();

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--status-blocked)]/30 bg-[var(--status-blocked)]/10 px-4 py-2 text-sm text-[var(--status-blocked)] sm:px-6">
      <p className="min-w-0">
        This workspace will be permanently deleted on {formatDate(deletesOn)} —{" "}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => cancelWorkspaceDeletion(), {
              success: "Deletion cancelled.",
              failure: "Couldn't cancel that here — try again from Admin → Data & privacy.",
              onSuccess: () => router.refresh(),
            })
          }
          className="font-semibold underline underline-offset-2 disabled:no-underline disabled:opacity-70"
        >
          {pending ? "cancelling…" : "cancel"}
        </button>
      </p>
    </div>
  );
}
