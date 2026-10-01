// The Tielora tab inside Microsoft Teams: "Your day", read-only.
//
//  - Dormant (no TEAMS_APP_ID set up): "not found". A framable "not found" page is harmless.
//  - Signed in: the brief for THIS person, from the very same `personBrief(actor)` the browser page
//    uses — for a contractor that is their own tasks and opt-in notices and nothing else. The actor
//    is built from the tab's own cookie (`getTeamsTabUser`), so its organisation is the session's.
//  - Not signed in: the sign-in state (or, after a sign-in that left no cookie behind, the "open
//    Tielora in your browser" message — `tried=1`).
// Reads only; writes nothing, not even an audit row (like the brief).

import { notFound } from "next/navigation";
import { getTeamsTabUser } from "@/lib/auth";
import { teamsAppConfig } from "@/lib/teams-app";
import { TeamsBrief } from "@/components/teams/teams-brief";
import { TeamsSignIn } from "@/components/teams/teams-sign-in";
import { actorForUser } from "@/server/actor";
import { personBrief } from "@/server/services/briefs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your day — Tielora" };

export default async function TeamsTabPage({
  searchParams,
}: {
  searchParams: Promise<{ tried?: string }>;
}) {
  if (!teamsAppConfig()) notFound();

  const user = await getTeamsTabUser();
  if (!user) {
    const params = await searchParams;
    return <TeamsSignIn cookiesBlocked={params.tried === "1"} />;
  }

  const actor = await actorForUser(user.id);
  const brief = await personBrief(actor);
  return <TeamsBrief brief={brief} contractor={user.role === "EXTERNAL"} />;
}
