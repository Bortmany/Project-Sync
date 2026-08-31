"use server";

// Server actions for projects. Each one is thin on purpose: parse the input, check who is asking,
// hand the work to the service, refresh the affected pages, return the standard result shape.

import { z } from "zod";
import type { ActionResult, ProjectDTO, ProjectDisciplineDTO, ProjectMemberDTO } from "@/lib/zod-schemas";
import {
  CreateProjectInput,
  SetExternalSignoffInput,
  UpdateProjectInput,
  UpsertMemberInput,
  UpsertProjectDisciplineInput,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateProject } from "@/server/actions/guard";
import * as projects from "@/server/services/projects";

const CHECK_FIELDS = "Please check the highlighted fields.";

const RemoveMemberInput = z.object({ projectId: z.string().min(1).max(40), userId: z.string().min(1).max(40) });
const RemoveDisciplineInput = z.object({
  projectId: z.string().min(1).max(40),
  disciplineId: z.string().min(1).max(40),
});

export async function createProject(input: CreateProjectInput): Promise<ActionResult<ProjectDTO>> {
  const parsed = CreateProjectInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-project", 20);
  if (guard.failure) return guard.failure;

  try {
    const project = await projects.createProject(guard.actor, parsed.data);
    revalidateProject(project.id);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error, { action: "createProject" });
  }
}

export async function updateProject(input: UpdateProjectInput): Promise<ActionResult<ProjectDTO>> {
  const parsed = UpdateProjectInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-project");
  if (guard.failure) return guard.failure;

  try {
    const project = await projects.updateProject(guard.actor, parsed.data);
    revalidateProject(project.id);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error, { action: "updateProject" });
  }
}

/** The project setting: does a contractor's finished work wait for somebody here to sign it off? */
export async function setExternalSignoffRequired(
  input: SetExternalSignoffInput,
): Promise<ActionResult<ProjectDTO>> {
  const parsed = SetExternalSignoffInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("set-external-signoff");
  if (guard.failure) return guard.failure;

  try {
    const project = await projects.setExternalSignoffRequired(guard.actor, parsed.data);
    revalidateProject(project.id);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error, { action: "setExternalSignoffRequired" });
  }
}

export async function upsertMember(input: UpsertMemberInput): Promise<ActionResult<ProjectMemberDTO>> {
  const parsed = UpsertMemberInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("upsert-member");
  if (guard.failure) return guard.failure;

  try {
    const member = await projects.upsertMember(guard.actor, parsed.data);
    revalidateProject(member.projectId);
    return { ok: true, data: member };
  } catch (error) {
    return toFailure(error, { action: "upsertMember" });
  }
}

export async function removeMember(input: {
  projectId: string;
  userId: string;
}): Promise<ActionResult<{ removed: true }>> {
  const parsed = RemoveMemberInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("remove-member");
  if (guard.failure) return guard.failure;

  try {
    const result = await projects.removeMember(guard.actor, parsed.data);
    revalidateProject(parsed.data.projectId);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error, { action: "removeMember" });
  }
}

export async function upsertProjectDiscipline(
  input: UpsertProjectDisciplineInput,
): Promise<ActionResult<ProjectDisciplineDTO>> {
  const parsed = UpsertProjectDisciplineInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("upsert-project-discipline");
  if (guard.failure) return guard.failure;

  try {
    const discipline = await projects.upsertProjectDiscipline(guard.actor, parsed.data);
    revalidateProject(discipline.projectId);
    return { ok: true, data: discipline };
  } catch (error) {
    return toFailure(error, { action: "upsertProjectDiscipline" });
  }
}

export async function removeProjectDiscipline(input: {
  projectId: string;
  disciplineId: string;
}): Promise<ActionResult<{ removed: true }>> {
  const parsed = RemoveDisciplineInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("remove-project-discipline");
  if (guard.failure) return guard.failure;

  try {
    const result = await projects.removeProjectDiscipline(guard.actor, parsed.data);
    revalidateProject(parsed.data.projectId);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error, { action: "removeProjectDiscipline" });
  }
}
