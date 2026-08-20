// The main tasks of one project, with the filters the list and board pages use. Every filter is validated.

import { z } from "zod";
import { PrioritySchema, TaskStatusSchema, toFieldErrors } from "@/lib/zod-schemas";
import { failFrom, failWithFields, guardRead, ok } from "@/server/http";
import { listMainTasksForProject } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

/** Query filters. Built from the shared enums so the values can never drift from the contract. */
const Filters = z.object({
  status: TaskStatusSchema.optional(),
  disciplineId: z.string().min(1).max(40).optional(),
  assigneeId: z.string().min(1).max(40).optional(),
  priority: PrioritySchema.optional(),
  q: z.string().trim().max(200).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-main-tasks");
  if (guard.response) return guard.response;

  const { id } = await context.params;
  const url = new URL(request.url);
  const raw = Object.fromEntries(
    ["status", "disciplineId", "assigneeId", "priority", "q"]
      .map((key) => [key, url.searchParams.get(key) ?? undefined])
      .filter(([, value]) => value !== undefined && value !== ""),
  );

  const parsed = Filters.safeParse(raw);
  if (!parsed.success) {
    return failWithFields(
      "Those filters are not valid. Check the status, priority or discipline you picked.",
      toFieldErrors(parsed.error),
    );
  }

  try {
    return ok(await listMainTasksForProject(guard.actor, id, parsed.data));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/main-tasks", projectId: id });
  }
}
