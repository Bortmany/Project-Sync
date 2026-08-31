// The noticeboard: announcements and the department board.
//
// Four rules govern this file:
//
//  1. **A post has exactly one audience** — the whole company, one project, or one discipline. That
//     is the pair of nullable ids on the row, and a post naming both a project and a discipline is
//     refused rather than guessed at.
//  2. **You see the audiences you belong to.** Everybody in the company reads the company-wide
//     board; a project board is for that project's members, a department board for that department.
//     An audience somebody does not belong to is NOT FOUND, never "forbidden" — the same shape the
//     rest of the app uses, so nobody learns an id is real by asking for it.
//  3. **A contractor has no noticeboard at all** (THE EXTERNAL RULE). Every read and every write
//     here answers "not found" for an EXTERNAL, and an announcement fan-out leaves them out exactly
//     as `projectAudience()` in tasks.ts does — a notification body is the one door read scoping
//     cannot close.
//  4. **Nothing is hard-deleted.** A removed post keeps its place as a tombstone so its replies
//     still make sense, exactly like a comment.
//
// Two documented deviations from house rule 1 (every mutation appends an audit row):
//  - **Dismissing an announcement writes no `ActivityLog` row.** Hiding a notice from your own
//    dashboard is personal read state, not company work — the same reason marking a notification
//    read, starring a project and jotting a personal to-do write none.
//  - **Changing who may post to Everyone IS audited** (it is a company setting), and it is refused
//    for anybody but an administrator with a plain `ForbiddenError`, the same way `editComment`
//    refuses somebody else's comment: `can()` answers "may you post", not "may you change the rule".

import { activeProjects, activeProjectsForUser, notDeleted, prisma } from "@/lib/db";
import { ForbiddenError, assertCan, can } from "@/lib/permissions";
import type {
  BoardPostDTO,
  BroadcastPolicyName,
  BroadcastSettingDTO,
  CreatePostInput,
  DismissAnnouncementInput,
  EditPostInput,
  PostAudienceDTO,
  PostAudienceKindName,
  PostDTO,
  PostKindName,
  ReplyToPostInput,
  SetBroadcastPolicyInput,
} from "@/lib/zod-schemas";
import {
  BoardPostDTO as BoardPostSchema,
  BroadcastSettingDTO as BroadcastSettingSchema,
  PostAudienceDTO as PostAudienceSchema,
  PostDTO as PostSchema,
  broadcastPolicyOf,
} from "@/lib/zod-schemas";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { notify } from "@/server/services/notify";

/** What a removed post says in the feed. The original text is never shown again. */
const TOMBSTONE_BODY = "Post removed";

/** How many board conversations one tab shows, and how many replies hang under each. */
const BOARD_ROOT_LIMIT = 50;
const BOARD_REPLY_LIMIT = 100;

/** How many running announcements one person is ever handed at once. */
const ANNOUNCEMENT_LIMIT = 50;

const MAX_BODY = 5000;
const MAX_TITLE = 200;

/** Where a post is aimed. Exactly one of the three shapes the row can hold. */
export type Audience = {
  kind: PostAudienceKindName;
  projectId: string | null;
  disciplineId: string | null;
};

/** An audience with the words a screen shows for it. */
type LabelledAudience = Audience & { key: string; label: string; colorHex: string | null };

/* ------------------------------------------------------------------ */
/* Audience keys — what the address bar carries                        */
/* ------------------------------------------------------------------ */

export function audienceKey(audience: Audience): string {
  if (audience.projectId) return `project:${audience.projectId}`;
  if (audience.disciplineId) return `discipline:${audience.disciplineId}`;
  return "everyone";
}

/** Reads `?tab=` back into an audience. Anything unrecognised is null, and the caller says so. */
export function parseAudienceKey(key: string): Audience | null {
  if (key === "everyone") return { kind: "EVERYONE", projectId: null, disciplineId: null };
  const [prefix, id] = key.split(":");
  if (!id || id.length > 40) return null;
  if (prefix === "project") return { kind: "PROJECT", projectId: id, disciplineId: null };
  if (prefix === "discipline") return { kind: "DISCIPLINE", projectId: null, disciplineId: id };
  return null;
}

function audienceOf(row: { projectId: string | null; disciplineId: string | null }): Audience {
  if (row.projectId) return { kind: "PROJECT", projectId: row.projectId, disciplineId: null };
  if (row.disciplineId)
    return { kind: "DISCIPLINE", projectId: null, disciplineId: row.disciplineId };
  return { kind: "EVERYONE", projectId: null, disciplineId: null };
}

/**
 * The permission context for one audience. `orgId` is always the actor's own company here, because
 * the audience row itself has already been proved to belong to it (`resolveAudience`).
 */
function contextFor(audience: Audience, orgId: string, policy: BroadcastPolicyName) {
  return audience.projectId
    ? { projectId: audience.projectId, orgId, disciplineId: null, broadcastPolicy: policy }
    : { orgId, disciplineId: audience.disciplineId, broadcastPolicy: policy };
}

/* ------------------------------------------------------------------ */
/* Who is allowed to be here at all                                    */
/* ------------------------------------------------------------------ */

/**
 * THE EXTERNAL RULE at this door. A contractor has no company noticeboard, no department and no
 * project board, so every one of them is "not found" — never "you may not", which would tell them
 * the page is real.
 */
function assertInternal(actor: ActorContext): void {
  if (isExternal(actor)) throw new NotFoundError("We could not find that page.");
}

/** The company's own setting, read from the row rather than assumed. */
export async function broadcastPolicyFor(actor: ActorContext): Promise<BroadcastPolicyName> {
  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { broadcastPolicy: true },
  });
  return broadcastPolicyOf(org?.broadcastPolicy);
}

/** May this person start a post here? The same answer for both kinds of post in this round. */
function mayPost(actor: ActorContext, audience: Audience, policy: BroadcastPolicyName): boolean {
  return can(actor, "POST_BOARD", contextFor(audience, actor.orgId, policy));
}

/**
 * May this person remove somebody else's post here?
 *
 * A project manager moderates their project's board, a discipline lead their department's, and an
 * administrator anywhere. **The company-wide board is moderated by administrators only** — a
 * manager who may START a company announcement still may not delete a colleague's one.
 */
function mayModerate(actor: ActorContext, audience: Audience, policy: BroadcastPolicyName): boolean {
  if (actor.role === "ADMIN") return true;
  if (audience.kind === "EVERYONE") return false;
  return mayPost(actor, audience, policy);
}

/* ------------------------------------------------------------------ */
/* The audiences one person has                                        */
/* ------------------------------------------------------------------ */

type Scope = {
  policy: BroadcastPolicyName;
  projects: { id: string; code: string }[];
  disciplines: { id: string; name: string; colorHex: string }[];
};

/**
 * Every audience this person belongs to, with the words each one is shown as.
 *
 * An administrator belongs to all of them — every project and every discipline **of their own
 * company**, which is the tenant rule, not an exception to it. Everybody else gets the projects
 * they are a member of and the discipline(s) they work in: their own department, plus any
 * discipline they hold a project seat for.
 */
async function scopeFor(actor: ActorContext): Promise<Scope> {
  const isAdmin = actor.role === "ADMIN";

  const [policy, projects, me] = await Promise.all([
    broadcastPolicyFor(actor),
    isAdmin
      ? activeProjects(actor.orgId)
      : activeProjectsForUser(actor.orgId, actor.userId),
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disciplineId: true } }),
  ]);

  const wantedDisciplineIds = new Set<string>();
  if (me?.disciplineId) wantedDisciplineIds.add(me.disciplineId);
  for (const membership of actor.memberships) {
    if (membership.disciplineId) wantedDisciplineIds.add(membership.disciplineId);
  }

  const disciplines = await prisma.discipline.findMany({
    where: {
      orgId: actor.orgId,
      ...(isAdmin ? {} : { id: { in: [...wantedDisciplineIds] } }),
    },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, colorHex: true },
  });

  return {
    policy,
    projects: projects.map((project) => ({ id: project.id, code: project.code })),
    disciplines,
  };
}

function labelledAudiences(scope: Scope): LabelledAudience[] {
  const everyone: LabelledAudience = {
    kind: "EVERYONE",
    projectId: null,
    disciplineId: null,
    key: "everyone",
    label: "Everyone",
    colorHex: null,
  };

  const projects: LabelledAudience[] = scope.projects.map((project) => ({
    kind: "PROJECT",
    projectId: project.id,
    disciplineId: null,
    key: `project:${project.id}`,
    label: project.code,
    colorHex: null,
  }));

  const disciplines: LabelledAudience[] = scope.disciplines.map((discipline) => ({
    kind: "DISCIPLINE",
    projectId: null,
    disciplineId: discipline.id,
    key: `discipline:${discipline.id}`,
    label: discipline.name,
    colorHex: discipline.colorHex,
  }));

  return [everyone, ...projects, ...disciplines];
}

/** The tab strip: every audience this person may read, and what they may do in each. */
export async function listAudiences(actor: ActorContext): Promise<PostAudienceDTO[]> {
  assertInternal(actor);
  const scope = await scopeFor(actor);

  const items = labelledAudiences(scope).map((audience) => ({
    key: audience.key,
    kind: audience.kind,
    projectId: audience.projectId,
    disciplineId: audience.disciplineId,
    label: audience.label,
    colorHex: audience.colorHex,
    canPost: mayPost(actor, audience, scope.policy),
    canModerate: mayModerate(actor, audience, scope.policy),
  }));

  return checkDtoList(PostAudienceSchema, items, "PostAudienceDTO");
}

/**
 * Proves an audience exists in this company and that this person belongs to it. A project or
 * discipline they are not part of — and another company's altogether — is **not found**.
 */
async function resolveAudience(
  actor: ActorContext,
  audience: Audience,
): Promise<{ audience: LabelledAudience; scope: Scope }> {
  const scope = await scopeFor(actor);
  const match = labelledAudiences(scope).find((candidate) => candidate.key === audienceKey(audience));
  if (!match) throw new NotFoundError("We could not find that board.");
  return { audience: match, scope };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const AUTHOR_INCLUDE = { select: { name: true, companyName: true } } as const;

type PostRow = {
  id: string;
  kind: string;
  projectId: string | null;
  disciplineId: string | null;
  title: string | null;
  body: string;
  authorId: string;
  expiresAt: Date | null;
  parentId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  author: { name: string; companyName: string | null };
  project?: { code: string } | null;
  discipline?: { name: string; colorHex: string } | null;
  dismissals?: { id: string }[];
};

/** The label an audience wears on a card, worked out from the row's own relations. */
function labelFor(row: PostRow, fallback?: LabelledAudience): { label: string; colorHex: string | null } {
  if (row.projectId) return { label: row.project?.code ?? fallback?.label ?? "", colorHex: null };
  if (row.disciplineId) {
    return {
      label: row.discipline?.name ?? fallback?.label ?? "",
      colorHex: row.discipline?.colorHex ?? fallback?.colorHex ?? null,
    };
  }
  return { label: "Everyone", colorHex: null };
}

function toPostDTO(
  row: PostRow,
  actor: ActorContext,
  policy: BroadcastPolicyName,
  fallback?: LabelledAudience,
): PostDTO {
  const audience = audienceOf(row);
  const { label, colorHex } = labelFor(row, fallback);
  const isDeleted = row.deletedAt !== null;
  const isMine = row.authorId === actor.userId;

  const dto: PostDTO = {
    id: row.id,
    kind: (row.kind === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : "BOARD") as PostKindName,
    audience: {
      key: audienceKey(audience),
      kind: audience.kind,
      projectId: audience.projectId,
      disciplineId: audience.disciplineId,
      label,
      colorHex,
    },
    title: isDeleted ? null : row.title,
    body: isDeleted ? TOMBSTONE_BODY : row.body,
    authorId: row.authorId,
    authorName: row.author.name,
    authorCompanyName: row.author.companyName ?? null,
    parentId: row.parentId,
    expiresAt: row.expiresAt,
    editedAt: isDeleted ? null : row.editedAt,
    isDeleted,
    dismissed: (row.dismissals?.length ?? 0) > 0,
    canEdit: !isDeleted && (isMine || actor.role === "ADMIN"),
    canDelete: !isDeleted && (isMine || mayModerate(actor, audience, policy)),
    createdAt: row.createdAt,
  };

  return checkDto(PostSchema, dto, "PostDTO");
}

/**
 * The announcements still running for this person: company-wide, plus their projects, plus their
 * department(s). Newest first.
 *
 * "Running" is derived, never stored: not removed, and either no expiry or an expiry still ahead —
 * the same shape `OVERDUE` and a locked phase take. One that this person has dismissed is FLAGGED,
 * not dropped: the dashboard strip hides it, the noticeboard still shows it.
 */
export async function listAnnouncementsForUser(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<PostDTO[]> {
  assertInternal(actor);
  const scope = await scopeFor(actor);
  const projectIds = scope.projects.map((project) => project.id);
  const disciplineIds = scope.disciplines.map((discipline) => discipline.id);

  const rows = await prisma.post.findMany({
    where: {
      orgId: actor.orgId,
      kind: "ANNOUNCEMENT",
      parentId: null,
      ...notDeleted,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        {
          OR: [
            { projectId: null, disciplineId: null },
            ...(projectIds.length > 0 ? [{ projectId: { in: projectIds } }] : []),
            ...(disciplineIds.length > 0 ? [{ disciplineId: { in: disciplineIds } }] : []),
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: ANNOUNCEMENT_LIMIT,
    include: {
      author: AUTHOR_INCLUDE,
      project: { select: { code: true } },
      discipline: { select: { name: true, colorHex: true } },
      dismissals: { where: { userId: actor.userId }, select: { id: true } },
    },
  });

  return rows.map((row) => toPostDTO(row, actor, scope.policy));
}

/**
 * One board: its conversations newest first, each with its replies oldest first.
 *
 * Removed posts stay in the list as tombstones so the replies under them still read properly —
 * deliberately not filtered out, exactly as the comment thread does it.
 */
export async function listBoard(
  actor: ActorContext,
  wanted: Audience,
): Promise<BoardPostDTO[]> {
  assertInternal(actor);
  const { audience, scope } = await resolveAudience(actor, wanted);

  const roots = await prisma.post.findMany({
    where: {
      orgId: actor.orgId,
      kind: "BOARD",
      parentId: null,
      projectId: audience.projectId,
      disciplineId: audience.disciplineId,
    },
    orderBy: { createdAt: "desc" },
    take: BOARD_ROOT_LIMIT,
    include: {
      author: AUTHOR_INCLUDE,
      project: { select: { code: true } },
      discipline: { select: { name: true, colorHex: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        take: BOARD_REPLY_LIMIT,
        include: { author: AUTHOR_INCLUDE },
      },
    },
  });

  const items = roots.map((root) => ({
    ...toPostDTO(root, actor, scope.policy, audience),
    replies: root.replies.map((reply) =>
      // A reply wears its parent's audience: the row itself carries no project or discipline.
      toPostDTO(
        { ...reply, projectId: root.projectId, disciplineId: root.disciplineId },
        actor,
        scope.policy,
        audience,
      ),
    ),
  }));

  return checkDtoList(BoardPostSchema, items, "BoardPostDTO");
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function cleanBody(value: string): string {
  const body = value.trim();
  if (body.length === 0) throw new ServiceError("Write something first.");
  if (body.length > MAX_BODY) {
    throw new ServiceError(`That is too long. Keep it under ${MAX_BODY} characters.`);
  }
  return body;
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = (value ?? "").trim();
  if (title.length === 0) return null;
  if (title.length > MAX_TITLE) {
    throw new ServiceError(`That title is too long. Keep it under ${MAX_TITLE} characters.`);
  }
  return title;
}

/** Starts an announcement or a board post, aimed at exactly one audience. */
export async function createPost(actor: ActorContext, input: CreatePostInput): Promise<PostDTO> {
  assertInternal(actor);

  const projectId = input.projectId ?? null;
  const disciplineId = input.disciplineId ?? null;
  if (projectId && disciplineId) {
    throw new ServiceError("A post goes to a project or to a department, not to both.");
  }

  const { audience, scope } = await resolveAudience(actor, {
    kind: projectId ? "PROJECT" : disciplineId ? "DISCIPLINE" : "EVERYONE",
    projectId,
    disciplineId,
  });

  assertCan(
    actor,
    input.kind === "ANNOUNCEMENT" ? "POST_ANNOUNCEMENT" : "POST_BOARD",
    contextFor(audience, actor.orgId, scope.policy),
  );

  const body = cleanBody(input.body);
  const title = cleanTitle(input.title);

  let expiresAt: Date | null = input.expiresAt ?? null;
  if (expiresAt && input.kind !== "ANNOUNCEMENT") {
    throw new ServiceError("Only an announcement can have a date it stops showing.");
  }
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ServiceError("Choose a date in the future for when this stops showing.");
  }
  if (input.kind !== "ANNOUNCEMENT") expiresAt = null;

  const postId = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        orgId: actor.orgId,
        kind: input.kind,
        projectId: audience.projectId,
        disciplineId: audience.disciplineId,
        title,
        body,
        authorId: actor.userId,
        expiresAt,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      // An audience-wide post belongs to no project, and an ActivityLog row is allowed to say so.
      projectId: audience.projectId,
      entityType: "Post",
      entityId: post.id,
      action: input.kind === "ANNOUNCEMENT" ? ACTIVITY.ANNOUNCEMENT_POSTED : ACTIVITY.POST_CREATED,
      summary:
        input.kind === "ANNOUNCEMENT"
          ? `${actor.name} posted an announcement to ${audience.label}`
          : `${actor.name} posted to the ${audience.label} board`,
      metadata: { audience: audience.key, hasExpiry: expiresAt !== null },
    });

    return post.id;
  });

  // Announcements tell people; board posts do not. A board is somewhere you go, not something that
  // arrives — only a direct reply reaches for somebody's attention (see replyToPost).
  if (input.kind === "ANNOUNCEMENT") {
    const recipients = await announcementRecipients(actor, audience);
    await notify(actor, recipients, "ANNOUNCEMENT", {
      title: "New announcement",
      body: `${actor.name} posted to ${audience.label}: ${headline(title, body)}`,
      linkUrl: `/messages?tab=${audience.key}`,
    });
  }

  return buildPostDTO(actor, postId, scope.policy);
}

/** Replies to a board conversation. One level deep, always — a reply's parent is always a root. */
export async function replyToPost(actor: ActorContext, input: ReplyToPostInput): Promise<PostDTO> {
  assertInternal(actor);

  const parent = await loadPost(actor, input.parentId);
  if (parent.kind !== "BOARD") throw new ServiceError("You can only reply on the board.");
  if (parent.parentId) {
    // The one-level rule, enforced here rather than trusted from the browser: a reply to a reply
    // would be a thread nobody specified and no screen can draw.
    throw new ServiceError("Replies go under the original post, not under another reply.");
  }
  if (parent.deletedAt) throw new ServiceError("That post was removed, so it cannot be replied to.");

  // Belonging to the audience is the whole permission: anybody who can read this board can join the
  // conversation on it. Starting one is the gated act (POST_BOARD), replying to one is not.
  const { audience, scope } = await resolveAudience(actor, audienceOf(parent));

  const body = cleanBody(input.body);

  const replyId = await prisma.$transaction(async (tx) => {
    const reply = await tx.post.create({
      data: {
        orgId: actor.orgId,
        kind: "BOARD",
        projectId: null,
        disciplineId: null,
        body,
        authorId: actor.userId,
        parentId: parent.id,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: audience.projectId,
      entityType: "Post",
      entityId: reply.id,
      action: ACTIVITY.POST_REPLIED,
      summary: `${actor.name} replied on the ${audience.label} board`,
      metadata: { audience: audience.key, parentId: parent.id },
    });

    return reply.id;
  });

  // A reply is a comment in spirit, so it borrows COMMENT_ADDED: the person whose post it is hears
  // about it in the app, and nothing goes to chat (COMMENT_ADDED maps to no chat toggle). Nobody
  // else on the board is notified — that is what makes a board a board.
  await notify(actor, [parent.authorId], "COMMENT_ADDED", {
    title: "New reply to your post",
    body: `${actor.name} replied to your post on ${audience.label}.`,
    linkUrl: `/messages?tab=${audience.key}`,
  });

  return buildPostDTO(actor, replyId, scope.policy, audience);
}

/** Changes the text of your own post. Administrators may also correct one. */
export async function editPost(actor: ActorContext, input: EditPostInput): Promise<PostDTO> {
  assertInternal(actor);

  const existing = await loadPost(actor, input.id);
  const parentAudience = await audienceOfPost(actor, existing);
  const { audience, scope } = await resolveAudience(actor, parentAudience);

  if (existing.deletedAt) throw new ServiceError("That post was removed, so it cannot be edited.");
  if (existing.authorId !== actor.userId && actor.role !== "ADMIN") {
    throw new ForbiddenError("POST_BOARD", "You can only edit your own posts.");
  }

  const body = cleanBody(input.body);
  const title = existing.parentId ? null : cleanTitle(input.title);

  await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: existing.id },
      data: { body, title, editedAt: new Date() },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: audience.projectId,
      entityType: "Post",
      entityId: existing.id,
      action: ACTIVITY.POST_EDITED,
      summary: `${actor.name} edited a post on ${audience.label}`,
      metadata: { audience: audience.key },
    });
  });

  return buildPostDTO(actor, existing.id, scope.policy, audience);
}

/**
 * Removes a post from view. The row stays, the feed shows a tombstone, the audit trail keeps both.
 * Your own always; anybody's inside a board you moderate.
 */
export async function deletePost(
  actor: ActorContext,
  input: { id: string },
): Promise<{ removed: true }> {
  assertInternal(actor);

  const existing = await loadPost(actor, input.id);
  const { audience, scope } = await resolveAudience(actor, await audienceOfPost(actor, existing));

  const isMine = existing.authorId === actor.userId;
  if (!isMine && !mayModerate(actor, audience, scope.policy)) {
    throw new ForbiddenError(
      "POST_BOARD",
      "You can only remove your own posts. Whoever looks after this board can remove anyone's.",
    );
  }

  if (existing.deletedAt) return { removed: true };

  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: audience.projectId,
      entityType: "Post",
      entityId: existing.id,
      action: ACTIVITY.POST_DELETED,
      summary: `${actor.name} removed a post on ${audience.label}`,
      metadata: { audience: audience.key, authorId: existing.authorId },
    });
  });

  return { removed: true };
}

/**
 * Hides one announcement from this person's own dashboard.
 *
 * Personal read state, so it writes no `ActivityLog` row — the documented deviation this file's
 * header names, the same one marking a notification read carries. Pressing it twice is fine.
 */
export async function dismissAnnouncement(
  actor: ActorContext,
  input: DismissAnnouncementInput,
): Promise<{ dismissed: true }> {
  assertInternal(actor);

  const post = await loadPost(actor, input.id);
  if (post.kind !== "ANNOUNCEMENT" || post.parentId) {
    throw new NotFoundError("We could not find that announcement.");
  }
  // Being allowed to see it is what makes it dismissible — someone else's audience is not found.
  await resolveAudience(actor, audienceOf(post));

  await prisma.postDismissal.upsert({
    where: { postId_userId: { postId: post.id, userId: actor.userId } },
    create: { postId: post.id, userId: actor.userId },
    update: {},
  });

  return { dismissed: true };
}

/** The company's noticeboard setting. Administrators only, and audited like any other org change. */
export async function setBroadcastPolicy(
  actor: ActorContext,
  input: SetBroadcastPolicyInput,
): Promise<BroadcastSettingDTO> {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError(
      "POST_ANNOUNCEMENT",
      "Only an administrator can change who may post to everyone.",
    );
  }

  const before = await broadcastPolicyFor(actor);

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: actor.orgId },
      data: { broadcastPolicy: input.policy },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.BROADCAST_POLICY_CHANGED,
      summary: `${actor.name} changed who can post to everyone`,
      metadata: { before, after: input.policy },
    });
  });

  return checkDto(BroadcastSettingSchema, { policy: input.policy }, "BroadcastSettingDTO");
}

/* ------------------------------------------------------------------ */
/* Loaders and small helpers                                           */
/* ------------------------------------------------------------------ */

/** A post in another company does not exist here — the gate is the row's own `orgId`. */
async function loadPost(actor: ActorContext, id: string) {
  const post = await prisma.post.findFirst({ where: { id, orgId: actor.orgId } });
  if (!post) throw new NotFoundError("We could not find that post.");
  return post;
}

/** A reply has no audience of its own: it wears its parent's. */
async function audienceOfPost(
  actor: ActorContext,
  post: { parentId: string | null; projectId: string | null; disciplineId: string | null },
): Promise<Audience> {
  if (!post.parentId) return audienceOf(post);

  const parent = await prisma.post.findFirst({
    where: { id: post.parentId, orgId: actor.orgId },
    select: { projectId: true, disciplineId: true },
  });
  if (!parent) throw new NotFoundError("We could not find that post.");
  return audienceOf(parent);
}

async function buildPostDTO(
  actor: ActorContext,
  postId: string,
  policy: BroadcastPolicyName,
  fallback?: LabelledAudience,
): Promise<PostDTO> {
  const row = await prisma.post.findFirst({
    where: { id: postId, orgId: actor.orgId },
    include: {
      author: AUTHOR_INCLUDE,
      project: { select: { code: true } },
      discipline: { select: { name: true, colorHex: true } },
      dismissals: { where: { userId: actor.userId }, select: { id: true } },
      parent: { select: { projectId: true, disciplineId: true } },
    },
  });
  if (!row) throw new NotFoundError("We could not find that post.");

  // A reply is shown wearing its parent's audience, which is what every screen labels it with.
  const shaped = row.parentId
    ? { ...row, projectId: row.parent?.projectId ?? null, disciplineId: row.parent?.disciplineId ?? null }
    : row;

  return toPostDTO(shaped, actor, policy, fallback);
}

/** The first line of an announcement: its title, or the opening of its body. */
function headline(title: string | null, body: string): string {
  const text = title ?? body;
  return text.length <= 120 ? text : `${text.slice(0, 119)}…`;
}

/**
 * Who hears about an announcement.
 *
 * **Contractors are left out of every one of them** — `role: { not: "EXTERNAL" }`, the same filter
 * `projectAudience()` carries in tasks.ts and phases.ts, for the same reason: a notification body
 * names work and news a contractor may not see, and a notification is the one door read scoping
 * cannot close. `notify()` then skips the author, anyone deactivated and anyone in another company.
 */
async function announcementRecipients(
  actor: ActorContext,
  audience: Audience,
): Promise<string[]> {
  if (audience.projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: audience.projectId, user: { orgId: actor.orgId, role: { not: "EXTERNAL" } } },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  const people = await prisma.user.findMany({
    where: {
      orgId: actor.orgId,
      isActive: true,
      role: { not: "EXTERNAL" },
      ...(audience.disciplineId ? { disciplineId: audience.disciplineId } : {}),
    },
    select: { id: true },
  });
  return people.map((person) => person.id);
}
