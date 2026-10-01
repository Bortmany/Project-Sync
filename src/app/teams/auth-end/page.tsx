// The Microsoft sign-in window's last stop. It is not framable (it is a window of its own), holds
// no form, and does one thing: read the one-time hand-off code from the address FRAGMENT (which no
// browser sends to a server), give it to the tab through Teams, and let Teams close the window.
// On a refusal it tells the tab so; the tab then shows its one generic sentence.

"use client";

import { useEffect, useState } from "react";
import { AuthEndView } from "@/components/teams/auth-end-view";
import { loadTeams } from "@/components/teams/teams-host";

export default function TeamsAuthEndPage() {
  const [outsideTeams, setOutsideTeams] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = fragment.get("code");
    // Forget the fragment at once so the code is not sitting in the address bar or history.
    window.history.replaceState(null, "", window.location.pathname);

    void (async () => {
      const teams = await loadTeams();
      if (!teams) {
        // Opened outside Teams: nobody to hand the code to, so say what to do instead of spinning.
        setOutsideTeams(true);
        return;
      }
      if (code && /^[0-9a-f]{64}$/.test(code)) teams.authentication.notifySuccess(code);
      else teams.authentication.notifyFailure("failed");
    })();
  }, []);

  return <AuthEndView outsideTeams={outsideTeams} />;
}
