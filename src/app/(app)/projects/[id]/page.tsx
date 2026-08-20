// One project: its header, tasks, team, and the tabs that arrive in later milestones.

import { ProjectView } from "@/components/projects/project-view";

export const metadata = { title: "Project — Project Nexus" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectView projectId={id} />;
}
