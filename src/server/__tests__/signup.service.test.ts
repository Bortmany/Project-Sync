// Signing a new company up, through the real route handler.
//
// This is the one public write in Tielora, so it is tested end to end: the zod parse, the IP rate
// limit, the transaction that builds the company, and the session cookie that comes back. The only
// thing stubbed is the cookie jar, which needs a live request to exist.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The cookie jar next/headers would give a route. Replaced per test so each starts empty. */
const jar = new Map<string, { value: string; expires?: Date }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const found = jar.get(name);
      return found ? { name, value: found.value } : undefined;
    },
    set: (name: string, value: string, options?: { expires?: Date }) => {
      jar.set(name, { value, expires: options?.expires });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

import { POST as signup } from "@/app/api/auth/signup/route";
import { prisma } from "@/lib/db";
import { IndustryTemplateSchema } from "@/lib/zod-schemas";
import type { SignupInput } from "@/lib/zod-schemas";
import { ServiceError } from "@/server/errors";
import { signUpOrganization } from "@/server/services/signup";
import { INDUSTRY_TEMPLATES, slugify, templatesUsePaletteColorsOnly } from "@/server/industry-templates";
import { SIGNUP_TEMPLATE_CARDS } from "@/app/(auth)/signup/template-cards";
import { resetDatabase } from "@/server/__tests__/harness";

const PASSWORD = "coordination-2026";

let ipCounter = 0;

/** A signup request from an IP address nobody else in this file has used. */
function request(body: unknown, ip?: string): Request {
  ipCounter += 1;
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? `203.0.113.${ipCounter}`,
      "user-agent": "vitest",
    },
    body: JSON.stringify(body),
  });
}

function form(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "Northern Works",
    industryTemplate: "OIL_AND_GAS",
    name: "Aisha al-Kindi",
    email: `aisha.${Math.random().toString(36).slice(2)}@northern.example`,
    password: PASSWORD,
    ...overrides,
  };
}

async function post(body: unknown, ip?: string) {
  const response = await signup(request(body, ip));
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("signing a company up", () => {
  it("creates the company, its disciplines, an administrator and a session, in one go", async () => {
    const input = form();
    const { status, body } = await post(input);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.organizationSlug).toBe("northern-works");
    expect(body.data.role).toBe("ADMIN");

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: body.data.organizationId },
      include: { disciplines: { orderBy: { sortOrder: "asc" } }, users: true },
    });
    expect(org.name).toBe("Northern Works");
    expect(org.industryTemplate).toBe("OIL_AND_GAS");

    // Exactly the template's disciplines, in the template's order.
    expect(org.disciplines.map((row) => row.name)).toEqual(
      INDUSTRY_TEMPLATES.OIL_AND_GAS.map((row) => row.name),
    );

    // One person, and they run the place.
    expect(org.users).toHaveLength(1);
    expect(org.users[0].email).toBe(input.email);
    expect(org.users[0].role).toBe("ADMIN");
    expect(org.users[0].passwordHash).not.toContain(PASSWORD);

    // The company's first audit row belongs to no project — that is why projectId is nullable.
    const audit = await prisma.activityLog.findMany({ where: { entityId: org.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("ORG_CREATED");
    expect(audit[0].projectId).toBeNull();
    expect(audit[0].actorId).toBe(org.users[0].id);

    // Signed in already: a session row exists and the cookie carries its raw token.
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe(org.users[0].id);
    expect(jar.get("nexus_session")?.value).toBeTruthy();
    // The raw token is never what is stored.
    expect(sessions[0].tokenHash).not.toBe(jar.get("nexus_session")?.value);
  });

  it("gives each template its own disciplines", async () => {
    const construction = await post(
      form({ organizationName: "Batinah Build", industryTemplate: "CONSTRUCTION" }),
    );
    const generic = await post(form({ organizationName: "Small Studio", industryTemplate: "GENERIC" }));

    const names = async (organizationId: string) =>
      (
        await prisma.discipline.findMany({
          where: { orgId: organizationId },
          orderBy: { sortOrder: "asc" },
        })
      ).map((row) => row.name);

    expect(await names(construction.body.data.organizationId)).toEqual([
      "Structural",
      "Architectural",
      "MEP",
      "Civil",
      "QA/QC",
      "HSE",
      "Surveying",
    ]);
    expect(await names(generic.body.data.organizationId)).toEqual([
      "Engineering",
      "Operations",
      "Quality",
    ]);
  });

  it("only ever gives a template brand palette colours", () => {
    expect(templatesUsePaletteColorsOnly()).toBe(true);
  });

  // The signup screen's template cards list the disciplines a template seeds, read straight from
  // INDUSTRY_TEMPLATES. A template the enum accepts but the lists do not cover would show an empty
  // card and seed a company with no disciplines at all.
  it("has a non-empty discipline list for every template the schema accepts", () => {
    for (const template of IndustryTemplateSchema.options) {
      expect(INDUSTRY_TEMPLATES[template]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  // A template with no card cannot be chosen, however happily the API would accept it.
  it("offers a signup card for every template the schema accepts, listing that template's real disciplines", () => {
    const cards = new Map(SIGNUP_TEMPLATE_CARDS.map((card) => [card.value, card]));

    expect([...cards.keys()].sort()).toEqual([...IndustryTemplateSchema.options].sort());
    for (const template of IndustryTemplateSchema.options) {
      const card = cards.get(template);
      expect(card?.label.length ?? 0).toBeGreaterThan(0);
      expect(card?.disciplines).toEqual(INDUSTRY_TEMPLATES[template].map((row) => row.name));
    }
  });

  it("gives two companies of the same name different handles", async () => {
    const first = await post(form({ organizationName: "Gulf Engineering" }));
    const second = await post(form({ organizationName: "Gulf Engineering" }));
    const third = await post(form({ organizationName: "gulf engineering!" }));

    expect(first.body.data.organizationSlug).toBe("gulf-engineering");
    expect(second.body.data.organizationSlug).toBe("gulf-engineering-2");
    expect(third.body.data.organizationSlug).toBe("gulf-engineering-3");
    expect(slugify("Gulf Engineering")).toBe("gulf-engineering");
  });

  it("refuses an email address that already has an account, pointing at the field", async () => {
    const input = form();
    await post(input);

    const again = await post(form({ organizationName: "Another Company", email: input.email }));
    expect(again.status).toBe(400);
    expect(again.body.ok).toBe(false);
    expect(again.body.fieldErrors.email).toBeTruthy();
    expect(again.body.error).toContain("Sign in instead.");

    // Nothing half-built was left behind: the second company does not exist.
    expect(await prisma.organization.count()).toBe(1);
  });

  it("refuses a short password and says how long it has to be", async () => {
    const { status, body } = await post(form({ password: "short" }));

    expect(status).toBe(400);
    expect(body.fieldErrors.password[0]).toContain("12 characters");
    expect(await prisma.organization.count()).toBe(0);
  });

  it("refuses a company name that is not a name and an address that is not an address", async () => {
    const { status, body } = await post(form({ organizationName: "A", email: "not-an-address" }));

    expect(status).toBe(400);
    expect(body.fieldErrors.organizationName).toBeTruthy();
    expect(body.fieldErrors.email).toBeTruthy();
    expect(await prisma.organization.count()).toBe(0);
  });

  it("refuses a made-up industry template", async () => {
    const { status, body } = await post(form({ industryTemplate: "SPACE_TRAVEL" }));
    expect(status).toBe(400);
    expect(body.fieldErrors.industryTemplate).toBeTruthy();
  });

  it("gives the loser of a same-instant race the same plain message, not a crash", async () => {
    // Both calls pass the "is this email taken?" check before either insert reaches the database,
    // which is exactly the race a pre-check cannot win. The unique index decides it.
    const email = "same.person@northern.example";
    const outcomes = await Promise.allSettled([
      signUpOrganization({ ...form({ email }), organizationName: "First Company" } as SignupInput),
      signUpOrganization({ ...form({ email }), organizationName: "Second Company" } as SignupInput),
    ]);

    const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const lost = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const failure = (lost[0] as PromiseRejectedResult).reason;
    expect(failure).toBeInstanceOf(ServiceError);
    expect(failure.fieldErrors.email).toBeTruthy();
    expect(failure.message).toContain("Sign in instead.");

    // Exactly one account and one company exist — the loser left nothing behind.
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.organization.count()).toBe(1);
  });

  it("gives two companies racing for the same handle one each", async () => {
    const outcomes = await Promise.all([
      signUpOrganization(form({ organizationName: "Twin Engineering" }) as SignupInput),
      signUpOrganization(form({ organizationName: "Twin Engineering" }) as SignupInput),
    ]);

    const slugs = outcomes.map((outcome) => outcome.result.organizationSlug).sort();
    expect(new Set(slugs).size).toBe(2);
    expect(slugs[0]).toBe("twin-engineering");
    expect(await prisma.organization.count()).toBe(2);
  });

  it("takes a second handle when the first is snatched between the look and the insert", async () => {
    // The slug race, made deterministic. The concurrent test above usually does not actually
    // collide — the two lookups interleave and pick different handles — which is exactly how a
    // broken retry could sit there looking green. Here the collision is guaranteed: a company
    // already holds "twin-engineering", and the handle lookup is told once that nothing is taken.
    await prisma.organization.create({
      data: { name: "Twin Engineering", slug: "twin-engineering", industryTemplate: "GENERIC" },
    });
    const lookup = vi.spyOn(prisma.organization, "findMany").mockResolvedValueOnce([] as never);

    const outcome = await signUpOrganization(
      form({ organizationName: "Twin Engineering" }) as SignupInput,
    );

    expect(outcome.result.organizationSlug).toBe("twin-engineering-2");
    // Twice: the blind look that caused the clash, then the retry's real one.
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await prisma.organization.count()).toBe(2);

    lookup.mockRestore();
  });

  it("stops one address signing companies up all day", async () => {
    const ip = "198.51.100.77";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowed = await post(form({ organizationName: `Rapid ${attempt}` }), ip);
      expect(allowed.status).toBe(200);
    }

    const blocked = await post(form({ organizationName: "Rapid 6" }), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain("Too many sign-ups");
    expect(await prisma.organization.count()).toBe(5);

    // Somebody else is unaffected — the limit is per address, not global.
    const elsewhere = await post(form({ organizationName: "Somewhere Else" }), "198.51.100.78");
    expect(elsewhere.status).toBe(200);
  });
});
