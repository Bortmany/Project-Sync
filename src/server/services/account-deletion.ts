// Your account → Delete my account.
//
// What deleting an account actually means here, and why it is anonymisation rather than a row
// disappearing:
//
//  - **The person goes.** Their name becomes "Former member", their address becomes a tombstone
//    that is not an address at all, their job title, employer, department and access end date are
//    cleared, their password hash is replaced with one nothing can match, and every session and
//    one-time email link they hold is deleted. They are signed out on the spot and can never sign
//    in again.
//  - **The work stays.** Their comments, the tasks they completed, every document revision they
//    uploaded and every audit row about them stay exactly where they are — that record is the
//    company's project history, not one person's profile, and the golden rule already says a
//    revision or an audit row is never altered or lost. Every screen reads the display name off the
//    `User` row through a live join, so the rename renames them everywhere at once.
//  - **Their acknowledgements stay too.** An acknowledgement is an attestation somebody relied on
//    (see "Acknowledgements" in docs/CONVENTIONS.md) — project work, not personal preference. What
//    goes with the person is the preference data: starred shortcuts, the private to-do list, and
//    dismissals, which are nothing but "I have hidden this from my own dashboard".
//  - **Notifications go, in both directions.** A notification is a nudge, never a record: the rows
//    addressed to them are their own inbox, and the rows *about* them carry a sentence with their
//    old name frozen into it. Deleting both keeps every LIVE surface honest.
//  - **`ActivityLog.summary` is the one place an old name deliberately survives**, and it is not a
//    surface we may rewrite: the audit trail records what happened, including who did it and what
//    they were called at the time. So the screens promise exactly that and no more — the work shows
//    "Former member", and entries already in the activity trail keep the name they were written
//    with. `/privacy`, `/terms` and the danger card all say it the same way; do not let one of them
//    drift into promising the name is gone everywhere.
//
// The whole change is ONE transaction. Half an anonymisation is worse than none.

import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type {
  AccountDeletedDTO,
  AccountDeletionOptionsDTO,
  DeleteMyAccountInput,
  RoleName,
} from "@/lib/zod-schemas";
import { ACCOUNT_DELETE_CONFIRMATION } from "@/lib/zod-schemas";
import {
  AccountDeletedDTO as AccountDeletedSchema,
  AccountDeletionOptionsDTO as OptionsSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { clearTwoFactor } from "@/server/services/two-factor";

/** The name every screen shows in place of somebody who has deleted their account. */
export const FORMER_MEMBER = "Former member";

/**
 * The refusal an administrator with nobody behind them is given.
 *
 * Deleting the last administrator would leave the company with no way to add people, manage
 * disciplines, connect a chat channel or take a copy of its own data — a lockout nobody could undo
 * from inside Tielora. It is the same rule `updateUser` already keeps when an administrator tries
 * to demote or deactivate the last one, worded for the person doing it to themselves.
 */
export const SOLE_ADMIN_REFUSAL =
  "You're the only administrator, so your account can't be deleted yet. Make someone else an administrator first, then try again.";

const WRONG_WORD = `Type ${ACCOUNT_DELETE_CONFIRMATION} to confirm.`;

/**
 * The tombstone that replaces an email address.
 *
 * It keeps the column's global uniqueness (the account id is in it, and ids are unique), it is a
 * `.invalid` address, which RFC 2606 reserves so that nothing can ever be delivered to it, and it
 * carries no part of the address it replaced. It exists only because `User.email` is required and
 * unique; nothing in the app ever shows it to anybody.
 */
export function emailTombstone(userId: string): string {
  return `deleted+${userId}@tielora.invalid`;
}

/** A password hash nothing anybody can type will ever match. The same idea an invitation uses. */
function unusableHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("hex"));
}

/**
 * Is this person the only administrator of their company who can still sign in?
 *
 * Used for the SCREEN's hint. The refusal that counts is `assertNotSoleAdmin()` below, which asks
 * the same question inside the transaction, behind a lock.
 */
async function isSoleActiveAdmin(actor: ActorContext): Promise<boolean> {
  if (actor.role !== "ADMIN") return false;
  // Counted inside this company only — an administrator administers their OWN company.
  const activeAdmins = await prisma.user.count({
    where: { orgId: actor.orgId, role: "ADMIN", isActive: true },
  });
  return activeAdmins <= 1;
}

/**
 * The refusal that actually holds, asked inside the deleting transaction.
 *
 * **Why a lock.** Counting administrators outside the transaction is a check-then-act race: two of
 * a company's two administrators pressing the button at the same moment would BOTH count two, both
 * pass, and both commit — leaving the company with zero administrators and no way back in from
 * inside Tielora, which is the one outcome this rule exists to prevent.
 *
 * `SELECT ... FOR UPDATE` on the company's own `Organization` row is what serialises them: every
 * account deletion in a company takes that row's lock first, so the second one waits, then counts,
 * then sees one administrator left and is refused. The lock is transaction-scoped, so it is always
 * released — the same reasoning the sweep's `pg_try_advisory_xact_lock` follows.
 */
async function assertNotSoleAdmin(
  tx: Prisma.TransactionClient,
  orgId: string,
  role: RoleName,
): Promise<void> {
  // Taken for every deletion, not only an administrator's: somebody being promoted or demoted in
  // the same moment must not slip between the lock and the count either.
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
  if (role !== "ADMIN") return;

  const activeAdmins = await tx.user.count({
    where: { orgId, role: "ADMIN", isActive: true },
  });
  if (activeAdmins <= 1) throw new ServiceError(SOLE_ADMIN_REFUSAL);
}

/**
 * What the card needs to know before anybody types anything: whether this person is the last
 * administrator standing. The screen shows the guidance up front instead of letting somebody type
 * the word and then be refused; the server refuses them anyway, which is the check that counts.
 */
export async function accountDeletionOptions(
  actor: ActorContext,
): Promise<AccountDeletionOptionsDTO> {
  return checkDto(
    OptionsSchema,
    { soleAdmin: await isSoleActiveAdmin(actor) },
    "AccountDeletionOptionsDTO",
  );
}

/**
 * Deletes the signed-in person's own account, and nobody else's.
 *
 * There is no id in the input and no `assertCan` call: the only account this can reach is
 * `actor.userId`, which comes from the session and from nowhere else. Any signed-in role may do it,
 * contractors included — it is their own data, not the company's.
 */
export async function deleteMyAccount(
  actor: ActorContext,
  input: DeleteMyAccountInput,
): Promise<AccountDeletedDTO> {
  // Checked here as well as in zod: a service is never allowed to assume its caller parsed.
  if (input.confirm !== ACCOUNT_DELETE_CONFIRMATION) {
    throw new ServiceError(WRONG_WORD, { confirm: [WRONG_WORD] });
  }

  const me = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!me || !me.isActive) throw new NotFoundError("We could not find your account.");

  // A cheap early refusal so the screen answers straight away and the slow hash below is never
  // computed for somebody who is going to be turned down. It is NOT the check that holds — that is
  // `assertNotSoleAdmin()` inside the transaction.
  if (await isSoleActiveAdmin(actor)) throw new ServiceError(SOLE_ADMIN_REFUSAL);

  // Hashing is slow and needs no transaction held open around it.
  const passwordHash = await unusableHash();

  await prisma.$transaction(async (tx) => {
    // First thing inside the transaction: take the company's row lock and ask again. Two
    // administrators pressing this at the same moment must not both be told yes.
    await assertNotSoleAdmin(tx, actor.orgId, me.role);

    await tx.user.update({
      where: { id: me.id },
      data: {
        name: FORMER_MEMBER,
        email: emailTombstone(me.id),
        passwordHash,
        jobTitle: null,
        companyName: null,
        disciplineId: null,
        accessExpiresAt: null,
        emailVerifiedAt: null,
        isActive: false,
      },
    });

    // Every way back in, closed in the same transaction as the change itself — the two-factor
    // secret and its recovery codes among them, because a credential belongs to the person who is
    // leaving and nothing about it is any part of the company's project record.
    await tx.session.deleteMany({ where: { userId: me.id } });
    await tx.emailToken.deleteMany({ where: { userId: me.id } });
    await clearTwoFactor(tx, me.id);

    // Personal preference data — theirs alone, read by nobody else, never project work.
    await tx.favorite.deleteMany({ where: { userId: me.id } });
    await tx.personalTask.deleteMany({ where: { userId: me.id } });
    await tx.postDismissal.deleteMany({ where: { userId: me.id } });

    // Nudges, not records: their own inbox, and the sentences elsewhere that froze their old name
    // into text. `PostAck` rows are deliberately NOT here — an acknowledgement is an attestation.
    await tx.notification.deleteMany({
      where: { OR: [{ userId: me.id }, { actorId: me.id }] },
    });

    await appendActivity(tx, {
      actorId: me.id,
      projectId: null,
      entityType: "User",
      entityId: me.id,
      action: ACTIVITY.ACCOUNT_DELETED,
      // NAME-FREE ON PURPOSE. This row is written in the same transaction that takes the name
      // away; repeating it here would put it straight back. Who it was is in `actorId`.
      summary: "A member deleted their own account",
      metadata: { anonymised: true, sessionsEnded: true },
    });
  });

  return checkDto(AccountDeletedSchema, { deleted: true }, "AccountDeletedDTO");
}
