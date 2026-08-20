// One main task: its derived status, its discipline tasks, and the actions each role is allowed.

import { MainTaskView } from "@/components/tasks/main-task-view";

export const metadata = { title: "Task — Project Nexus" };

export default async function MainTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MainTaskView taskId={id} />;
}
