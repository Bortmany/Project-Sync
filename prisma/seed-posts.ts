// Demo noticeboard for the seeded project: two live announcements and one board conversation.
//
// Everything goes through the posts service with the real person as the actor, so the audience
// rules are genuinely exercised — an announcement aimed at a department nobody leads, or a board
// post from somebody who may not start one, would fail the seed rather than land in the database.

import type { ActorContext } from "@/server/actor";
import { createPost, replyToPost } from "@/server/services/posts";

export type SeedPostsContext = {
  /** The demo project whose board the conversation sits on. */
  projectId: string;
  /** The demo company's disciplines, keyed by code — the same map prisma/seed.ts builds. */
  disciplineIdByCode: Map<string, string>;
  /** The cached actor builder from the seed, so every post is written by the real person. */
  actorFor: (email: string) => Promise<ActorContext>;
};

export type SeedPostsResult = { announcements: number; boardPosts: number };

/** Days from now, at the current time of day — so a seeded expiry is never already in the past. */
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

export async function seedPosts(ctx: SeedPostsContext): Promise<SeedPostsResult> {
  const admin = await ctx.actorFor("admin@tielora.example");
  const mechanicalLead = await ctx.actorFor("khalid.alfarsi@tielora.example");
  const projectManager = await ctx.actorFor("layla.alriyami@tielora.example");

  /* Company-wide, from the administrator. It stops showing in a fortnight, which is what makes the
     "running" derivation visible in the demo. */
  await createPost(admin, {
    kind: "ANNOUNCEMENT",
    title: "Q3 HSE stand-down — Thursday 10:00",
    body:
      "Every team stops work for the quarterly HSE stand-down on Thursday at 10:00 in the main " +
      "auditorium. Bring your team's near-miss reports for the quarter. Anyone on site that " +
      "morning joins from the site office by video.",
    expiresAt: inDays(14),
  });

  /* One department, from its lead. Only a lead of that discipline may post here. */
  await createPost(mechanicalLead, {
    kind: "ANNOUNCEMENT",
    title: "Mechanical: new nozzle load datasheet template",
    body:
      "From Sunday, all vendor nozzle loads go on the new datasheet template in the mechanical " +
      "folder. The old sheet does not carry the settlement allowance, so please do not reuse it " +
      "for the expansion train packages.",
    disciplineId: ctx.disciplineIdByCode.get("MECH") as string,
    expiresAt: inDays(21),
  });

  /* A short conversation on the project's own board: the manager starts it, two engineers answer.
     A board post notifies nobody — a reply reaches only the person who started the thread. */
  const thread = await createPost(projectManager, {
    kind: "BOARD",
    title: "Package A submission — what is still open?",
    body:
      "We are two weeks from the Package A submission. Please post here with anything still open " +
      "on your discipline so I can put one honest list in front of the client on Sunday.",
    projectId: ctx.projectId,
  });

  await replyToPost(await ctx.actorFor("john.carter@tielora.example"), {
    parentId: thread.id,
    body:
      "Mechanical is clear apart from the datasheet pack, which is with the lead for sign-off. " +
      "Nothing else outstanding from my side.",
  });

  await replyToPost(await ctx.actorFor("priya.nair@tielora.example"), {
    parentId: thread.id,
    body:
      "Instrumentation: the control narrative is drafted but not issued. I need the vibration " +
      "monitoring scope agreed first, otherwise it will be reissued straight away.",
  });

  return { announcements: 2, boardPosts: 3 };
}
