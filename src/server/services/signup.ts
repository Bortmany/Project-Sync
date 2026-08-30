// Signing a new company up to Tielora: the one place an Organization is ever created.
//
// Everything a company needs to be usable on its first day is written in ONE transaction — the
// organisation, the disciplines its industry template comes with, the person who runs it (as
// ADMIN), the first audit row, and their session. If any part fails, none of it happened: there is
// never a half-built company with people in it and no disciplines.
//
// This is the only route in the app that runs without a signed-in actor, so it takes no
// ActorContext: the person it creates IS the actor from here on.

import { hashPassword, mintSession, type MintedSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { SignupInput, SignupResultDTO } from "@/lib/zod-schemas";
import { SignupResultDTO as SignupResultSchema } from "@/lib/zod-schemas";
import { ServiceError } from "@/server/errors";
import { disciplinesForTemplate, slugify } from "@/server/industry-templates";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";

/** How many "-2", "-3" … endings a company name may need before signup gives up. */
const SLUG_ATTEMPTS = 50;

export type SignupOutcome = {
  result: SignupResultDTO;
  /** The freshly minted session — the route sets the cookie with it, exactly as sign-in does. */
  session: MintedSession;
};

/**
 * Creates a company, its disciplines, its first administrator and their session.
 *
 * The email address is unique across the whole product (one address, one company), so an address
 * already in use is refused with a field error in the same shape every other form uses.
 */
export async function signUpOrganization(
  input: SignupInput,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<SignupOutcome> {
  const clash = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (clash) throw emailTaken();

  const base = slugify(input.organizationName);
  const disciplines = disciplinesForTemplate(input.industryTemplate);
  const passwordHash = await hashPassword(input.password);
  const session = mintSession();
  const write = (slug: string) =>
    writeOrganization({ input, meta, slug, disciplines, passwordHash, session });

  // The two checks above are a courtesy, not the decision — two people signing up in the same
  // instant both pass them. The unique indexes on User.email and Organization.slug are the real
  // answer, and whoever loses that race gets the same plain-English message, never a blank 500.
  let created;
  try {
    created = await write(await freeSlug(base));
  } catch (error) {
    if (uniqueViolationOn(error, "email")) throw emailTaken();
    if (!uniqueViolationOn(error, "slug")) throw error;

    // Somebody took the handle between our look and our insert. Ask again, try once more.
    try {
      created = await write(await freeSlug(base));
    } catch (retry) {
      if (uniqueViolationOn(retry, "email")) throw emailTaken();
      if (!uniqueViolationOn(retry, "slug")) throw retry;
      throw new ServiceError(
        "That company name was taken while you were signing up. Please try again.",
        { organizationName: ["That company name was just taken. Try again."] },
      );
    }
  }

  const result = checkDto(
    SignupResultSchema,
    {
      id: created.user.id,
      name: created.user.name,
      role: created.user.role,
      organizationId: created.organization.id,
      organizationName: created.organization.name,
      organizationSlug: created.organization.slug,
    },
    "SignupResultDTO",
  );

  return { result, session };
}

type WriteInput = {
  input: SignupInput;
  meta: { ip?: string | null; userAgent?: string | null };
  slug: string;
  disciplines: { code: string; name: string; colorHex: string; sortOrder: number }[];
  passwordHash: string;
  session: MintedSession;
};

/** The whole company in one transaction. Called again with a fresh handle if the first one raced. */
async function writeOrganization({
  input,
  meta,
  slug,
  disciplines,
  passwordHash,
  session,
}: WriteInput) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug,
        industryTemplate: input.industryTemplate,
        disciplines: { create: disciplines },
      },
    });

    const user = await tx.user.create({
      data: {
        orgId: organization.id,
        email: input.email,
        name: input.name,
        passwordHash,
        // Whoever signs the company up runs it — there is nobody else to grant them access.
        role: "ADMIN",
      },
    });

    await tx.session.create({
      data: {
        tokenHash: session.tokenHash,
        userId: user.id,
        expiresAt: session.expiresAt,
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });

    // The company's first audit row. It belongs to no project, which is why ActivityLog.projectId
    // is nullable — an organisation-level event has no project to hang off.
    await appendActivity(tx, {
      actorId: user.id,
      projectId: null,
      entityType: "Organization",
      entityId: organization.id,
      action: ACTIVITY.ORG_CREATED,
      summary: `${user.name} created ${organization.name} on Tielora`,
      metadata: {
        slug: organization.slug,
        industryTemplate: organization.industryTemplate,
        disciplines: disciplines.length,
      },
    });

    return { organization, user };
  });
}

/** The one wording for "this address is spoken for", however we came to find out. */
function emailTaken(): ServiceError {
  return new ServiceError("That email address already has a Tielora account. Sign in instead.", {
    email: ["That email address already has a Tielora account."],
  });
}

/**
 * True when the database refused an insert because of the unique index on this column.
 *
 * `P2002` is the reliable part; WHERE Prisma puts the column name is not. Behind the `pg` driver
 * adapter `meta.target` is not the plain array the documentation suggests, so this reads two things
 * and accepts either: the whole of `meta` serialised, and the message, which always spells the
 * column out ("Unique constraint failed on the fields: (`email`)"). Matching one exact shape is how
 * this check quietly stopped working once already.
 */
function uniqueViolationOn(error: unknown, column: "email" | "slug"): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown; message?: unknown };
  if (candidate.code !== "P2002") return false;

  let described = typeof candidate.message === "string" ? candidate.message : "";
  try {
    described += JSON.stringify(candidate.meta ?? {});
  } catch {
    // A meta object that will not serialise tells us nothing; the message still might.
  }

  return described.toLowerCase().includes(column);
}

/**
 * The company's handle. Two companies with the same name both get one: the first takes "acme", the
 * next "acme-2", and so on. The unique index on Organization.slug is still the last word — a race
 * that beats this check fails the insert rather than sharing a handle.
 */
async function freeSlug(base: string): Promise<string> {
  const taken = new Set(
    (
      await prisma.organization.findMany({
        where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
        select: { slug: true },
      })
    ).map((row) => row.slug),
  );

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= SLUG_ATTEMPTS; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new ServiceError(
    "A lot of companies already use that name. Add a word to it — your city, for example.",
    { organizationName: ["That company name is already in use here."] },
  );
}
