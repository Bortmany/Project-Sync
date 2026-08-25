// Demo comments for the seeded project.
//
// Everything here goes through the comment service with the real person as the actor, so the demo
// data carries genuine audit rows and the mention rules are actually exercised — a mention of someone
// who is not on the project would fail the seed rather than quietly land in the database.

import { prisma } from "@/lib/db";
import type { ActorContext } from "@/server/actor";
import { createComment, deleteComment, editComment } from "@/server/services/comments";

/** What the seed hands this module: the demo project and the people already created. */
export type SeedCommentsContext = {
  projectId: string;
  /** Every seeded person, keyed by email. */
  userIdByEmail: Map<string, string>;
  /** The cached actor builder from the seed, so comments are posted as the real person. */
  actorFor: (email: string) => Promise<ActorContext>;
};

type SeedComment = {
  /** Who writes it. */
  author: string;
  /** The discipline task it hangs off, by title — or the main task, by title. */
  disciplineTask?: string;
  mainTask?: string;
  body: string;
  /** People named in the body, by email — all of them are on the demo project. */
  mentions?: string[];
  /** The text this comment is edited to afterwards, if any. */
  editedTo?: string;
  /** True when the seed removes it afterwards, leaving a tombstone in the thread. */
  remove?: boolean;
};

const COMMENTS: SeedComment[] = [
  {
    author: "yousuf.alamri@omanlng.example",
    disciplineTask: "Civil foundation load check",
    body: "Load calculations are done for the compressor plinth. Waiting on the soil investigation summary before I can close this out.",
  },
  {
    author: "layla.alriyami@omanlng.example",
    disciplineTask: "Civil foundation load check",
    body: "@Yousuf al-Amri can you confirm the settlement figures were checked against the revised soil report? The client asked about it in the weekly meeting.",
    mentions: ["yousuf.alamri@omanlng.example"],
  },
  {
    author: "yousuf.alamri@omanlng.example",
    disciplineTask: "Civil foundation load check",
    body: "Confirmed — settlement is within 12 mm, well inside the allowance. I will attach the revised calculation sheet once the vendor loads are frozen.",
  },
  {
    author: "john.carter@omanlng.example",
    disciplineTask: "Mechanical design review comments closed",
    body: "All 34 review comments are closed. Two were merged because they raised the same nozzle orientation issue.",
  },
  {
    author: "khalid.alfarsi@omanlng.example",
    disciplineTask: "Mechanical design review comments closed",
    body: "Good work. Noting for the record that the vendor data sheet is a nice-to-have here, so it does not hold up completion.",
  },
  {
    author: "aisha.alkindi@omanlng.example",
    disciplineTask: "Inspection release certificates collected",
    body: "Still blocked. The vendor has not released certificates for the two spare exchangers — chasing their QA manager again this week.",
  },
  {
    author: "omar.alhabsi@omanlng.example",
    disciplineTask: "Inspection release certificates collected",
    body: "@Aisha al-Kindi please copy me on the next chaser so I can escalate through procurement if there is no answer by Sunday.",
    mentions: ["aisha.alkindi@omanlng.example"],
  },
  {
    author: "ahmed.albalushi@omanlng.example",
    disciplineTask: "Motor data sheets reviewed",
    body: "Reviewed 6 of 9 data sheets. The 11 kV motor sheets are missing the insulation class, so I have raised a comment back to the vendor.",
    editedTo:
      "Reviewed 7 of 9 data sheets. The 11 kV motor sheets are missing the insulation class, so I have raised a comment back to the vendor.",
  },
  {
    author: "priya.nair@omanlng.example",
    disciplineTask: "Vibration monitoring scope reviewed",
    body: "Scope looks thin on the gearbox side. I want proximity probes on both bearings rather than a single casing sensor.",
  },
  {
    author: "daniel.okoro@omanlng.example",
    disciplineTask: "Vibration monitoring scope reviewed",
    body: "@Priya Nair agreed — the failure history on this frame size supports two probes. I will reference it in the criticality assessment.",
    mentions: ["priya.nair@omanlng.example"],
  },
  {
    author: "maria.santos@omanlng.example",
    disciplineTask: "Relief scenario recalculated",
    body: "Relief case recalculated for the new train duty. The existing header is adequate with 8% margin.",
  },
  {
    author: "salim.alhinai@omanlng.example",
    mainTask: "HAZOP Action Close-out",
    body: "All safety-critical actions are closed. The remaining reliability action is an improvement item, not a safety one.",
  },
  {
    author: "layla.alriyami@omanlng.example",
    mainTask: "HAZOP Action Close-out",
    body: "Noted. I have recorded the override with the MOC reference so the audit trail explains why this closed early.",
  },
  {
    author: "john.carter@omanlng.example",
    mainTask: "Prepare Package A for Final Approval",
    body: "Wrong thread — this belongs on the compressor package review.",
    remove: true,
  },
  {
    author: "omar.alhabsi@omanlng.example",
    mainTask: "Prepare Package A for Final Approval",
    body: "Package A is on track apart from the inspection certificates. Everything else should be with the client by the first week of November.",
  },
];

/** Posts the demo conversation. Called by prisma/seed.ts once the project and its tasks exist. */
export async function seedComments(ctx: SeedCommentsContext): Promise<number> {
  const mainTasks = await prisma.mainTask.findMany({
    where: { projectId: ctx.projectId },
    select: { id: true, title: true },
  });
  const mainTaskIdByTitle = new Map(mainTasks.map((task) => [task.title, task.id]));

  const disciplineTasks = await prisma.disciplineTask.findMany({
    where: { mainTask: { projectId: ctx.projectId } },
    select: { id: true, title: true },
  });
  const disciplineTaskIdByTitle = new Map(disciplineTasks.map((task) => [task.title, task.id]));

  let written = 0;

  for (const seeded of COMMENTS) {
    const actor = await ctx.actorFor(seeded.author);

    const mainTaskId = seeded.mainTask ? mainTaskIdByTitle.get(seeded.mainTask) : undefined;
    const disciplineTaskId = seeded.disciplineTask
      ? disciplineTaskIdByTitle.get(seeded.disciplineTask)
      : undefined;
    if (!mainTaskId && !disciplineTaskId) {
      throw new Error(
        `Seed comments: no task called "${seeded.mainTask ?? seeded.disciplineTask}" on the demo project.`,
      );
    }

    const comment = await createComment(actor, {
      body: seeded.body,
      mainTaskId: mainTaskId ?? null,
      disciplineTaskId: disciplineTaskId ?? null,
      mentions: (seeded.mentions ?? []).map((email) => ctx.userIdByEmail.get(email) as string),
    });
    written += 1;

    if (seeded.editedTo) await editComment(actor, { id: comment.id, body: seeded.editedTo });
    if (seeded.remove) await deleteComment(actor, { id: comment.id });
  }

  return written;
}
