// Who is offered "New revision": the same people assertCanUploadTo() lets through on the server.

import { describe, expect, it } from "vitest";
import { canUploadRevisionTo } from "@/components/documents/can-upload";
import type { MeDTO } from "@/components/hooks/use-api";
import type { ProjectDTO } from "@/lib/zod-schemas";

function me(id: string, role: string): MeDTO {
  return { id, role } as MeDTO;
}
function project(members: { userId: string; projectRole: string; disciplineId?: string | null }[]): ProjectDTO {
  return { id: "p1", members } as unknown as ProjectDTO;
}

const siblings = [
  { disciplineTaskId: "dt1", assigneeId: "eng" },
  { disciplineTaskId: "dt2", assigneeId: "ext" },
];

describe("canUploadRevisionTo", () => {
  const p = project([
    { userId: "pm", projectRole: "PROJECT_MANAGER" },
    { userId: "lead", projectRole: "DISCIPLINE_LEAD", disciplineId: "d1" },
    { userId: "eng", projectRole: "ENGINEER", disciplineId: "d1" },
    { userId: "eng2", projectRole: "ENGINEER", disciplineId: "d1" },
    { userId: "ext", projectRole: "EXTERNAL" },
  ]);

  it("offers it to a manager and a lead on the project", () => {
    expect(canUploadRevisionTo(me("pm", "PROJECT_MANAGER"), p, { disciplineTaskId: "dt1" }, siblings)).toBe(true);
    expect(canUploadRevisionTo(me("lead", "DISCIPLINE_LEAD"), p, { disciplineTaskId: "dt1" }, siblings)).toBe(true);
  });

  it("offers it to the assignee of the document's own task and to nobody else", () => {
    expect(canUploadRevisionTo(me("eng", "ENGINEER"), p, { disciplineTaskId: "dt1" }, siblings)).toBe(true);
    expect(canUploadRevisionTo(me("eng2", "ENGINEER"), p, { disciplineTaskId: "dt1" }, siblings)).toBe(false);
    expect(canUploadRevisionTo(me("eng", "ENGINEER"), p, { disciplineTaskId: "dt2" }, siblings)).toBe(false);
  });

  it("lets a contributor revise a shared main-task document, but never a contractor", () => {
    expect(canUploadRevisionTo(me("eng", "ENGINEER"), p, { disciplineTaskId: null }, siblings)).toBe(true);
    expect(canUploadRevisionTo(me("eng2", "ENGINEER"), p, { disciplineTaskId: null }, siblings)).toBe(false);
    expect(canUploadRevisionTo(me("ext", "EXTERNAL"), p, { disciplineTaskId: null }, siblings)).toBe(false);
    expect(canUploadRevisionTo(me("ext", "EXTERNAL"), p, { disciplineTaskId: "dt2" }, siblings)).toBe(true);
  });

  it("offers nothing before the person has loaded", () => {
    expect(canUploadRevisionTo(undefined, p, { disciplineTaskId: "dt1" }, siblings)).toBe(false);
  });
});
