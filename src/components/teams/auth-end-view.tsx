// What the Microsoft sign-in window shows: a spinner while it hands the code to the tab, or — when
// the window was opened outside Teams, so there is no tab to hand it to — one plain sentence.

import { Spinner } from "@/components/ui";

export const AUTH_END_OUTSIDE_TEAMS = "Close this window and try again from Teams.";

export function AuthEndView({ outsideTeams }: { outsideTeams: boolean }) {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center gap-3 text-sm text-[var(--brand-text)]"
      role="status"
    >
      {outsideTeams ? null : <Spinner size={20} />}
      <span>{outsideTeams ? AUTH_END_OUTSIDE_TEAMS : "Signing you in…"}</span>
    </div>
  );
}
