// A person's own email choices: alert emails, the daily brief and the weekly brief.
//
// Three rules govern this file:
//  1. **Only ever your own.** Neither the Your-account change nor the read takes an id: the only
//     account either can reach is the session's (the `deleteMyAccount` precedent, so no `assertCan`).
//     The unsubscribe link reaches exactly the one person its signature names, and nobody else.
//  2. **A change that changes something is recorded; one that does not, is not.** One
//     `EMAIL_PREFERENCES_CHANGED` row, inside the same transaction, only when a value actually
//     moved — `metadata: { changed, via }`, never a token. Consent is worth a record, so this is
//     deliberately not another exception to house rule 1.
//  3. **A contractor is never sent a brief.** Their two brief flags are ignored when they are set,
//     read back as off, and skipped by the sender whatever the row says.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";
import type { EmailPreferencesDTO, UnsubscribeKindName } from "@/lib/zod-schemas";
import {
  EmailPreferencesDTO as EmailPreferencesSchema,
  EmailPreferencesInput as EmailPreferencesInputSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { emailAvailable } from "@/server/services/email";

/** The three stored choices, by their column names. */
type PreferenceField = "emailAlerts" | "emailDailyBrief" | "emailWeeklyBrief";

const FIELDS: PreferenceField[] = ["emailAlerts", "emailDailyBrief", "emailWeeklyBrief"];

/** The two a contractor never has. */
const BRIEF_FIELDS: PreferenceField[] = ["emailDailyBrief", "emailWeeklyBrief"];

/** Which column an unsubscribe link switches off. */
const FIELD_FOR_KIND: Record<UnsubscribeKindName, PreferenceField> = {
  ALERTS: "emailAlerts",
  DAILY: "emailDailyBrief",
  WEEKLY: "emailWeeklyBrief",
};

/** The words for each, used in the audit summary. */
const WORDS: Record<PreferenceField, string> = {
  emailAlerts: "alert emails",
  emailDailyBrief: "the daily brief email",
  emailWeeklyBrief: "the weekly brief email",
};

type Via = "account" | "unsubscribe-link";

const PREFERENCE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  emailVerifiedAt: true,
  emailAlerts: true,
  emailDailyBrief: true,
  emailWeeklyBrief: true,
} as const;

type PreferenceRow = Prisma.UserGetPayload<{ select: typeof PREFERENCE_SELECT }>;

function toDTO(row: PreferenceRow): EmailPreferencesDTO {
  const external = row.role === "EXTERNAL";
  return checkDto(
    EmailPreferencesSchema,
    {
      emailAlerts: row.emailAlerts,
      // A contractor is never sent either brief, so the card never shows them as on.
      emailDailyBrief: external ? false : row.emailDailyBrief,
      emailWeeklyBrief: external ? false : row.emailWeeklyBrief,
      verified: row.emailVerifiedAt !== null,
      available: emailAvailable(),
      email: row.email,
    },
    "EmailPreferencesDTO",
  );
}

/** "Jane Marsh turned on the daily brief email and turned off alert emails" */
function summaryFor(name: string, changed: Partial<Record<PreferenceField, boolean>>, via: Via): string {
  const parts = FIELDS.filter((field) => changed[field] !== undefined).map(
    (field) => `turned ${changed[field] ? "on" : "off"} ${WORDS[field]}`,
  );
  const tail = via === "unsubscribe-link" ? " from an unsubscribe link" : "";
  return `${name} ${parts.join(" and ")}${tail}`;
}

async function appendPreferenceActivity(
  tx: Prisma.TransactionClient,
  row: PreferenceRow,
  changed: Partial<Record<PreferenceField, boolean>>,
  via: Via,
): Promise<void> {
  await appendActivity(tx, {
    actorId: row.id,
    projectId: null,
    entityType: "User",
    entityId: row.id,
    action: ACTIVITY.EMAIL_PREFERENCES_CHANGED,
    summary: summaryFor(row.name, changed, via),
    metadata: { changed, via },
  });
}

/** What the Email card on Your account draws. Your own, and nobody else's. */
export async function emailPreferencesFor(actor: ActorContext): Promise<EmailPreferencesDTO> {
  const row = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: PREFERENCE_SELECT,
  });
  if (!row) throw new NotFoundError("We could not find your account.");
  return toDTO(row);
}

/**
 * Changes the signed-in person's own email choices. Anything not sent is left as it is.
 *
 * Switching the daily brief ON stamps `dailyBriefEmailedAt` with this moment, so the first one
 * arrives with the next morning's sweep rather than this afternoon — which is what the card says.
 */
export async function setEmailPreferences(
  actor: ActorContext,
  input: unknown,
): Promise<EmailPreferencesDTO> {
  // A service never assumes its caller parsed.
  const parsed = EmailPreferencesInputSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError("Choose at least one email setting to change.");

  return prisma.$transaction(async (tx) => {
    const row = await tx.user.findFirst({
      where: { id: actor.userId, orgId: actor.orgId, isActive: true },
      select: PREFERENCE_SELECT,
    });
    if (!row) throw new NotFoundError("We could not find your account.");

    const external = row.role === "EXTERNAL";
    const changed: Partial<Record<PreferenceField, boolean>> = {};
    for (const field of FIELDS) {
      const value = parsed.data[field];
      if (value === undefined) continue;
      if (external && BRIEF_FIELDS.includes(field)) continue;
      if (row[field] !== value) changed[field] = value;
    }

    if (Object.keys(changed).length === 0) return toDTO(row);

    const updated = await tx.user.update({
      where: { id: row.id },
      data: {
        ...changed,
        ...(changed.emailDailyBrief === true ? { dailyBriefEmailedAt: new Date() } : {}),
      },
      select: PREFERENCE_SELECT,
    });
    await appendPreferenceActivity(tx, row, changed, "account");
    return toDTO(updated);
  });
}

/** Stands in for a real person on a miss, so a bad token costs one lookup like a good one. */
const NOBODY = "unsubscribe-no-such-person";

/**
 * Carries out an unsubscribe link: switches off exactly the kind of email it names, for exactly the
 * person it names. Answers nothing, whatever happened — the route and the page say the same
 * sentence for a genuine link, a tampered one, an old one, a deactivated account or no link at all.
 *
 * A deactivated or anonymised account is left alone. The switch is one conditional update
 * (`WHERE <kind> = true`), so a link pressed twice — or by a mail client and a person at once —
 * writes exactly one audit row, with the person as the actor, never the token.
 */
export async function unsubscribeWithToken(token: string | null | undefined): Promise<void> {
  const claim = verifyUnsubscribeToken(token);

  await prisma.$transaction(async (tx) => {
    // The same one lookup on a hit and a miss, so the time taken says nothing about which it was.
    const row = await tx.user.findUnique({
      where: { id: claim?.personId ?? NOBODY },
      select: PREFERENCE_SELECT,
    });
    if (!claim || !row || !row.isActive) return;

    const field = FIELD_FOR_KIND[claim.kind];
    const flipped = await tx.user.updateMany({
      where: { id: row.id, isActive: true, [field]: true },
      data: { [field]: false },
    });
    if (flipped.count === 1) {
      await appendPreferenceActivity(tx, row, { [field]: false }, "unsubscribe-link");
    }
  });
}
