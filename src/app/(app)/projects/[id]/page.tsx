// One project: its header, tasks, team, and the tabs that arrive in later milestones.

import { ProjectView } from "@/components/projects/project-view";
import { currentActor } from "@/server/session";
import { askTieloraAvailable } from "@/server/services/ai-panel";

export const metadata = { title: "Project — Tielora" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ask Tielora is drawn only if the SERVER says so for this person: key set, their company's switch
  // on, an internal role. A contractor's page is built without it (THE EXTERNAL RULE), not styled away.
  const actor = await currentActor();
  const askTielora = actor ? await askTieloraAvailable(actor) : false;
  return <ProjectView projectId={id} askTielora={askTielora} />;
}
