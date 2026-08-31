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
//  3. **A contractor has no noticeboard** (THE EXTERNAL RULE). Every read and every write here
//     answers "not found" for an EXTERNAL, and an announcement fan-out leaves them out exactly as
//     `projectAudience()` in tasks.ts does — a notification body is the one door read scoping
//     cannot close. The ONE exception is deliberate, narrow and opt-in: an announcement whose
//     author ticked `includeExternals` also reaches the contractors of that audience, and they read
//     it — title, body, who posted it, when — as a read-only line on their own daily brief. They
//     still get no board, no dismissal, no Acknowledge button, no /messages page, and they are
//     never counted in anybody's acknowledgement total. See `listNoticesForExternal` below.
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
//
// **Acknowledging is NOT the same kind of thing as dismissing**, and this file draws the line in one
// place so nobody has to guess. A dismissal is private read state; an acknowledgement is an
// attestation the author relies on and may be asked to show, so it appends ONE `ActivityLog` row
// (`POST_ACKNOWLEDGED`) inside the same transaction as the row itself — house rule 1, no deviation.
// The two also cannot be confused by accident: an announcement that asks to be acknowledged cannot
// be dismissed until it has been, so pressing ✕ can never quietly stand in for confirming.

import {
  activeProjects,
  activeProjectsForExternal,
  activeProjectsForUser,
  notDeleted,
  prisma,
} from "@/lib/db";
import { ForbiddenError, assertCan, can } from "@/lib/permissions";
import type {
  AcknowledgePostInput,
  BoardPostDTO,
  BroadcastPolicyName,
  BroadcastSettingDTO,
  CreatePostInput,
  DismissAnnouncementInput,
  EditPostInput,
  PostAckProgressDTO,
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
  DEFAULT_BROADCAST_POLICY,
  OUTSTANDING_ACK_LIMIT,
  PostAudienceDTO as PostAudienceSchema,
  PostDTO as PostSchema,
  broadcastPolicyOf,
} from "@/lib/zod-schemas";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { documentForBoardPost, visibleDocumentChips } from "@/server/services/documents";
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
  requiresAck: boolean;
  includeExternals: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  author: { name: string; companyName: string | null };
  project?: { code: string } | null;
  discipline?: { name: string; colorHex: string } | null;
  dismissals?: { id: string }[];
};

/**
 * What one reader is told about acknowledgements on one post: their own state always, and the
 * progress block only when they are the author or an administrator.
 */
type AckView = {
  acked: boolean;
  ackedAt: Date | null;
  progress: PostAckProgressDTO | null;
};

const NO_ACKS: AckView = { acked: false, ackedAt: null, progress: null };

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
  ack: AckView = NO_ACKS,
): PostDTO {
  const audience = audienceOf(row);
  const { label, colorHex } = labelFor(row, fallback);
  const isDeleted = row.deletedAt !== null;
  const isMine = row.authorId === actor.userId;

  // The only post a contractor ever reaches is an announcement whose author included them, and they
  // read it and nothing else: no Acknowledge button, no dismissal, no editing, no removing. Every
  // one of those is computed false HERE, on the server, rather than trusted to a screen to hide.
  const readOnly = isExternal(actor);

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
    // A removed announcement asks nothing of anybody any more, so the whole acknowledgement block
    // goes with its text — the same way a tombstone loses its title.
    requiresAck: !isDeleted && !readOnly && row.requiresAck,
    acked: ack.acked,
    ackedAt: ack.ackedAt,
    ackProgress: isDeleted ? null : ack.progress,
    canEdit: !isDeleted && !readOnly && (isMine || actor.role === "ADMIN"),
    canDelete: !isDeleted && !readOnly && (isMine || mayModerate(actor, audience, policy)),
    createdAt: row.createdAt,
  };

  return checkDto(PostSchema, dto, "PostDTO");
}

/* ------------------------------------------------------------------ */
/* Acknowledgements — one person's own state, and the author's count    */
/* ------------------------------------------------------------------ */

/** The shape `ackViewsFor` needs from a row. Whole rows satisfy it; nothing extra is read. */
type AckSourceRow = {
  id: string;
  kind: string;
  parentId: string | null;
  requiresAck: boolean;
  deletedAt: Date | null;
  authorId: string;
  projectId: string | null;
  disciplineId: string | null;
};

/**
 * Everything the acknowledgement block on a set of posts needs, for ONE reader.
 *
 * Two rules decide what comes back:
 *  - **Their own state, always.** Whether this person has acknowledged, and when.
 *  - **The count and the outstanding names, only for the author and an administrator.** Nobody else
 *    is ever told who has and has not confirmed — the audience never sees each other's status.
 *
 * Bounded and batched, like every other read in this app: one query for this person's own rows, one
 * for every acknowledgement on the posts they may see counts for, and one per DISTINCT audience in
 * the set (never one per post). The names come out of that same audience read.
 */
async function ackViewsFor(
  actor: ActorContext,
  rows: AckSourceRow[],
): Promise<Map<string, AckView>> {
  const views = new Map<string, AckView>();

  const asking = rows.filter(
    (row) => row.requiresAck && row.kind === "ANNOUNCEMENT" && !row.parentId && !row.deletedAt,
  );
  if (asking.length === 0) return views;

  const askingIds = asking.map((row) => row.id);
  // The author of a post, and an administrator of this company, may see how it is going. Everybody
  // else gets their own state and nothing else.
  const withProgress = asking.filter(
    (row) => row.authorId === actor.userId || actor.role === "ADMIN",
  );

  const [mine, everyAck] = await Promise.all([
    prisma.postAck.findMany({
      where: { postId: { in: askingIds }, userId: actor.userId },
      select: { postId: true, createdAt: true },
    }),
    withProgress.length === 0
      ? Promise.resolve([] as { postId: string; userId: string }[])
      : prisma.postAck.findMany({
          where: { postId: { in: withProgress.map((row) => row.id) } },
          select: { postId: true, userId: true },
        }),
  ]);

  const myAckAt = new Map(mine.map((row) => [row.postId, row.createdAt]));

  // One read per DISTINCT audience, whatever the number of posts aimed at it — and all of them at
  // once. An administrator's strip can carry 50 announcements across as many projects, and asking
  // for them one after another would be 50 round trips in a row before the page could draw.
  const distinctAudiences = new Map<string, Audience>();
  for (const row of withProgress) {
    const audience = audienceOf(row);
    distinctAudiences.set(audienceKey(audience), audience);
  }

  const memberLists = new Map<string, { id: string; name: string }[]>(
    await Promise.all(
      [...distinctAudiences].map(
        async ([key, audience]) =>
          [key, await audienceMembers(actor, audience)] as [string, { id: string; name: string }[]],
      ),
    ),
  );

  for (const row of asking) {
    const at = myAckAt.get(row.id) ?? null;
    let progress: PostAckProgressDTO | null = null;

    if (withProgress.some((candidate) => candidate.id === row.id)) {
      const members = memberLists.get(audienceKey(audienceOf(row))) ?? [];
      const acked = new Set(
        everyAck.filter((ack) => ack.postId === row.id).map((ack) => ack.userId),
      );
      // Counted over the audience as it stands now, so "N of M" can never read more than its total
      // when somebody has left the project since they confirmed.
      const outstanding = members.filter((member) => !acked.has(member.id));
      progress = {
        ackCount: members.length - outstanding.length,
        audienceCount: members.length,
        outstandingNames: outstanding.slice(0, OUTSTANDING_ACK_LIMIT).map((member) => member.name),
        outstandingTotal: outstanding.length,
      };
    }

    views.set(row.id, { acked: at !== null, ackedAt: at, progress });
  }

  return views;
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

  const acks = await ackViewsFor(actor, rows);
  return rows.map((row) => toPostDTO(row, actor, scope.policy, undefined, acks.get(row.id)));
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

  // The chips, resolved through THIS reader's own visibility rather than the foreign key. A
  // document removed since it was attached, or one on a project this person is not on, simply has
  // no entry and the card draws nothing — no placeholder and no title, which is the whole rule.
  const attachments = await visibleDocumentChips(
    actor,
    roots.map((root) => root.documentId).filter((id): id is string => id !== null),
  );

  const items = roots.map((root) => ({
    ...toPostDTO(root, actor, scope.policy, audience),
    // A removed post loses its attachment with its text, exactly as it loses its title.
    attachment:
      root.deletedAt || !root.documentId
        ? null
        : (attachments.get(root.documentId) ?? null),
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

  // Asking a whole audience to sign for something is a heavier act than telling them, so it is
  // narrower than posting: an ADMIN or a PROJECT_MANAGER, and nobody else. A department lead whom
  // the company's broadcast setting lets announce may still only tell people.
  //
  // The rule is the AUTHOR'S OWN ROLE, deliberately, and it is enforced here rather than in `can()`:
  // `can()` answers "may you post to this audience", which is a question about the audience, and
  // there is no honest way to fold "and may you also demand a signature" into that shape. It is the
  // same reasoning that keeps replying out of POST_BOARD.
  const requiresAck = input.requiresAck === true;
  if (requiresAck && input.kind !== "ANNOUNCEMENT") {
    throw new ServiceError("Only an announcement can ask people to acknowledge it.");
  }
  if (requiresAck && actor.role !== "ADMIN" && actor.role !== "PROJECT_MANAGER") {
    throw new ForbiddenError(
      "POST_ANNOUNCEMENT",
      "Only an administrator or a project manager can ask people to acknowledge an announcement.",
    );
  }

  // Reaching contractors is the opt-in exception to "a contractor has no noticeboard", and it is
  // kept as narrow as the exception deserves: an ANNOUNCEMENT only (a board is somewhere you go,
  // and they have none), and only to the whole company or to one project. Never a department — a
  // contractor works on a project, not in one of this company's departments — so there is no
  // audience where "include the contractors" would have an honest meaning.
  const includeExternals = input.includeExternals === true;
  if (includeExternals && input.kind !== "ANNOUNCEMENT") {
    throw new ServiceError("Only an announcement can be sent to contractors.");
  }
  if (includeExternals && audience.disciplineId) {
    throw new ServiceError(
      "A department announcement cannot include contractors. Send it to the project or to everyone.",
    );
  }

  // One document, on a PROJECT board, on the post that starts the conversation. Announcements are
  // told, not browsed, and a reply never carries one — `replyToPost` has no such input at all.
  //
  // Company-wide and department boards deliberately offer no attachment this round: picking a
  // document there means searching across every project a person can see, which is a new
  // tenant-sensitive read surface, and this round does not need one.
  let documentId: string | null = null;
  if (input.documentId) {
    if (input.kind !== "BOARD") {
      throw new ServiceError("Only a board post can point at a document.");
    }
    if (!audience.projectId) {
      throw new ServiceError("You can only attach a document on a project board.");
    }
    // Every miss here is NOT FOUND, through the documents service's own loader: another company's
    // id, another project's id, one that has been removed, and one on a project this person may not
    // see all answer identically.
    documentId = (await documentForBoardPost(actor, input.documentId, audience.projectId)).id;
  }

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
        requiresAck,
        includeExternals,
        documentId,
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
      metadata: {
        audience: audience.key,
        hasExpiry: expiresAt !== null,
        requiresAck,
        includeExternals,
        // The id only — the audit trail records that a post points at a document, never its title,
        // which the reader's own visibility decides at read time.
        documentId,
      },
    });

    return post.id;
  });

  // Announcements tell people; board posts do not. A board is somewhere you go, not something that
  // arrives — only a direct reply reaches for somebody's attention (see replyToPost).
  if (input.kind === "ANNOUNCEMENT") {
    const line = `${actor.name} posted to ${audience.label}: ${headline(title, body)}`;

    const recipients = await announcementRecipients(actor, audience);
    await notify(actor, recipients, "ANNOUNCEMENT", {
      title: "New announcement",
      body: line,
      linkUrl: `/messages?tab=${audience.key}`,
    });

    // The included contractors, told separately for ONE reason: the link. /messages is not found
    // for them, so a notification pointing there would be a door into a wall — and a notification
    // must never send anybody somewhere they may not go. Their copy points at "Your day", which is
    // where the notice itself appears for them. Same type, same words, different destination.
    //
    // No chat copy on this second call: the company's own Slack or Teams channel has already had
    // this announcement once, and a second copy differing only in its link would be noise.
    if (includeExternals) {
      const contractors = await externalAudienceMembers(actor, audience);
      await notify(
        actor,
        contractors,
        "ANNOUNCEMENT",
        {
          title: "New announcement",
          body: line,
          linkUrl: "/my-tasks/brief",
        },
        { chatCopy: false },
      );
    }
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

  // ONE announcement cannot be hidden before it is acknowledged. The two controls sit on the same
  // card, and this is the simplest honest way to keep them apart: without it, pressing ✕ would look
  // like dealing with the notice while leaving the author still waiting. Once it is acknowledged,
  // dismissing works exactly as it does for any other announcement.
  if (post.requiresAck && !(await hasAcknowledged(post.id, actor.userId))) {
    throw new ServiceError(
      "Acknowledge this first. Once you have, you can hide it from your dashboard.",
    );
  }

  await prisma.postDismissal.upsert({
    where: { postId_userId: { postId: post.id, userId: actor.userId } },
    create: { postId: post.id, userId: actor.userId },
    update: {},
  });

  return { dismissed: true };
}

/** Has this person already confirmed this one? One tiny lookup on the unique index. */
async function hasAcknowledged(postId: string, userId: string): Promise<boolean> {
  const row = await prisma.postAck.findUnique({
    where: { postId_userId: { postId, userId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Confirms that this person has read an announcement that asked for it.
 *
 * Who may: **anybody internal who may READ the announcement** — belonging to its audience is the
 * whole permission, exactly as it is for replying on a board. A contractor is refused not-found at
 * the door with everything else here; they have no announcements surface and no Acknowledge button,
 * and they are never counted in the author's total either.
 *
 * Unlike a dismissal, this writes an `ActivityLog` row: somebody asked for a signature and this is
 * it. Exactly one row, ever — pressing the button twice (or in two tabs at once) is silently the
 * same acknowledgement, because the unique index says one row per person per post.
 */
export async function acknowledgePost(
  actor: ActorContext,
  input: AcknowledgePostInput,
): Promise<PostDTO> {
  assertInternal(actor);

  const post = await loadPost(actor, input.id);
  // An announcement that never asked to be acknowledged has no such button and no such row: saying
  // "not found" rather than "you may not" keeps it the same shape as every other miss here.
  if (post.kind !== "ANNOUNCEMENT" || post.parentId || post.deletedAt || !post.requiresAck) {
    throw new NotFoundError("We could not find that announcement.");
  }

  // Being in the audience is the permission. Somebody else's project or department is not found.
  const { audience, scope } = await resolveAudience(actor, audienceOf(post));

  if (!(await hasAcknowledged(post.id, actor.userId))) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.postAck.create({ data: { postId: post.id, userId: actor.userId } });

        // **DELIBERATELY UNPROJECTED, and deliberately name-free.** Both project feeds read
        // `ActivityLog` by `projectId` (`listActivity` and `recentActivityForProjects`) and both
        // render `summary` and `actorName`, so a row carrying either would show "so-and-so
        // acknowledged an announcement" to every member of the project — while the DTO, the
        // conventions and the privacy page all promise that who has acknowledged is for the post's
        // author and an administrator alone. `projectId: null` keeps it out of both feeds (the same
        // thing that lets the organisation-level ORG_CREATED row exist), and the summary names
        // nobody.
        //
        // Nothing is lost from the audit trail: `actorId` holds who, `entityId` holds which
        // announcement, `createdAt` holds when, and `PostAck` is the row the author's own count is
        // read from. The record is complete; it is just not gossip.
        await appendActivity(tx, {
          actorId: actor.userId,
          projectId: null,
          entityType: "Post",
          entityId: post.id,
          action: ACTIVITY.POST_ACKNOWLEDGED,
          summary: "An announcement was acknowledged",
          metadata: { audience: audience.key },
        });
      });
    } catch (error) {
      // Two tabs pressing at once: the unique index is the referee and the loser has nothing left
      // to do — the acknowledgement it wanted is already recorded, with its one audit row.
      if (!isDuplicateRow(error)) throw error;
    }
  }

  return buildPostDTO(actor, post.id, scope.policy, audience);
}

/** The unique-constraint violation, by Postgres' own code — the only part of the error to trust. */
function isDuplicateRow(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
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

  const acks = await ackViewsFor(actor, [shaped]);
  return toPostDTO(shaped, actor, policy, fallback, acks.get(shaped.id));
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
  return (await audienceMembers(actor, audience)).map((member) => member.id);
}

/**
 * The INTERNAL audience of one post, by name, alphabetically.
 *
 * This is the single derivation behind two numbers that have to agree: who an announcement is sent
 * to, and the "M" in "N of M acknowledged". If they came from two queries they would drift, and an
 * author would be left waiting on somebody who was never told.
 *
 * Contractors are left out of every one of them (`role: { not: "EXTERNAL" }`) — the same filter
 * `projectAudience()` carries in tasks.ts and phases.ts. So are deactivated accounts, which
 * `notify()` skips anyway: counting somebody who can never sign in again would make a total nobody
 * could ever finish.
 */
async function audienceMembers(
  actor: ActorContext,
  audience: Audience,
): Promise<{ id: string; name: string }[]> {
  if (audience.projectId) {
    const members = await prisma.projectMember.findMany({
      where: {
        projectId: audience.projectId,
        user: { orgId: actor.orgId, isActive: true, role: { not: "EXTERNAL" } },
      },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    });
    return members.map((member) => member.user);
  }

  return prisma.user.findMany({
    where: {
      orgId: actor.orgId,
      isActive: true,
      role: { not: "EXTERNAL" },
      ...(audience.disciplineId ? { disciplineId: audience.disciplineId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * The contractors one INCLUDED announcement reaches. Empty unless its author asked for them.
 *
 * Deliberately a separate function from `audienceMembers()` above, and never folded into it: that
 * one is the single derivation behind who is told AND the "M" in "N of M acknowledged", and a
 * contractor must never appear in the second. Keeping them apart is what makes it impossible for
 * including contractors to change anybody's acknowledgement total by accident.
 *
 * The narrowing is the one every external read takes:
 *  - **company-wide** — the active contractors of this company;
 *  - **one project** — only the contractors holding LIVE assigned work on THAT project, which is
 *    exactly what `assertCanViewProject()` demands of them before it shows them a project at all.
 *    Being listed as a project member is not enough, for the same reason it is not enough anywhere
 *    else: work is what makes a project theirs.
 *
 * A department audience never gets here — `createPost` refuses the combination outright.
 */
async function externalAudienceMembers(
  actor: ActorContext,
  audience: Audience,
): Promise<string[]> {
  if (audience.disciplineId) return [];

  const contractors = await prisma.user.findMany({
    where: {
      orgId: actor.orgId,
      isActive: true,
      role: "EXTERNAL",
      ...(audience.projectId
        ? {
            assignedTasks: {
              some: {
                ...notDeleted,
                mainTask: {
                  ...notDeleted,
                  projectId: audience.projectId,
                  project: { orgId: actor.orgId, ...notDeleted },
                },
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  return contractors.map((contractor) => contractor.id);
}

/**
 * A contractor's whole noticeboard: the announcements somebody explicitly included them in, still
 * running, newest first. Read-only, and it is the ONLY post read an EXTERNAL is ever answered.
 *
 * Two audiences reach them, and nothing else does:
 *  - **company-wide** notices with `includeExternals` on;
 *  - **project** notices with it on, and only on the projects they hold live assigned work on —
 *    the same narrowing `activeProjectsForExternal` gives every other read of theirs. A project
 *    whose work has finished or been reassigned stops being theirs here at the same moment it
 *    stops being theirs everywhere else.
 *
 * A department notice can never appear: `createPost` refuses the flag on that audience, so there is
 * nothing to filter out. "Included" is a column on the post and "running" is derived, exactly as it
 * is for a colleague — nothing about a contractor's notices is stored anywhere.
 */
export async function listNoticesForExternal(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<PostDTO[]> {
  if (!isExternal(actor)) return [];

  const projects = await activeProjectsForExternal(actor.orgId, actor.userId);
  const projectIds = projects.map((project) => project.id);

  const rows = await prisma.post.findMany({
    where: {
      orgId: actor.orgId,
      kind: "ANNOUNCEMENT",
      parentId: null,
      includeExternals: true,
      ...notDeleted,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        {
          OR: [
            { projectId: null, disciplineId: null },
            ...(projectIds.length > 0 ? [{ projectId: { in: projectIds } }] : []),
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
    },
  });

  // The policy is only ever used to work out what this reader may DO, and a contractor may do
  // nothing here — `toPostDTO` computes every one of those flags false for them.
  return rows.map((row) => toPostDTO(row, actor, DEFAULT_BROADCAST_POLICY));
}
