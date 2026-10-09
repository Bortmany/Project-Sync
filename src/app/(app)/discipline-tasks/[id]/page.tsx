// One discipline task: the engineer's page for their piece of a main task.

import { requireDisciplineTaskVisible } from "@/server/page-guards";
import { DisciplineTaskView } from "@/components/tasks/discipline-task-view";

export const metadata = { title: "Discipline task — Tielora" };

export default async function DisciplineTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDisciplineTaskVisible(id);
  return <DisciplineTaskView taskId={id} />;
}
