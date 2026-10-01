// Admin → Integrations and Your account, as the "Microsoft first" build draws them.
//
// Render tests, like public-pages.test.tsx: the session and every service the two pages read are
// mocked, so no database is touched and each test chooses exactly what the server "said". They pin:
//
//  1. Integrations: Microsoft 365 first, then the Teams chat card — titled "Microsoft Teams
//     channel" — then Slack, then the noticeboard, whatever order the database answers in. While no
//     Azure app is registered the Microsoft card is simply absent and the rest close up.
//  2. The Microsoft 365 card's two labelled parts, and its On state reading only company facts.
//  3. Your account: no Email card at all while email is dormant; Alerts and Daily brief when it is
//     set up; Alerts only for a contractor (THE EXTERNAL RULE); the Weekly brief row for everyone else.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDate } from "@/components/format";
import type {
  EmailPreferencesDTO,
  MicrosoftConnectionDTO,
  MicrosoftSignInStatusDTO,
  OrgIntegrationDTO,
  RoleName,
} from "@/lib/zod-schemas";

/* ------------------------------------------------------------------ */
/* What the mocked server hands back — set by each test                */
/* ------------------------------------------------------------------ */

const TOGGLES = {
  taskAssigned: true,
  mention: true,
  statusChange: true,
  overdueReminder: true,
  gateOverride: true,
  announcements: false,
  dailyBrief: false,
  weeklyBrief: false,
};

function chat(kind: "SLACK" | "TEAMS"): OrgIntegrationDTO {
  return {
    kind,
    configured: false,
    enabled: false,
    webhookUrlMasked: null,
    eventToggles: TOGGLES,
    updatedAt: null,
  };
}

const state: {
  role: RoleName;
  integrations: OrgIntegrationDTO[];
  connection: MicrosoftConnectionDTO;
  signIn: MicrosoftSignInStatusDTO;
  emailAvailable: boolean;
  preferences: EmailPreferencesDTO;
} = {} as never;

function reset(): void {
  state.role = "ADMIN";
  // The database's own order is Slack first — the screen must not follow it.
  state.integrations = [chat("SLACK"), chat("TEAMS")];
  state.connection = {
    available: true,
    callbackReady: true,
    connected: false,
    tenantDomain: null,
    connectedByName: null,
    connectedAt: null,
    needsReconnect: false,
  };
  state.signIn = {
    enabled: false,
    domain: null,
    enabledByName: null,
    enabledAt: null,
    linkedPeople: 0,
    callbackReady: true,
  };
  state.emailAvailable = true;
  state.preferences = {
    emailAlerts: true,
    emailDailyBrief: false,
    emailWeeklyBrief: false,
    verified: true,
    available: true,
    email: "salma@company.com",
  };
}

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
}));

vi.mock("@/server/session", () => ({
  currentActor: async () => ({
    userId: "user-1",
    orgId: "org-1",
    role: state.role,
    memberships: [],
    name: "Salma Al Hinai",
    email: "salma@company.com",
  }),
}));

vi.mock("@/server/services/integrations", () => ({
  listIntegrationsForAdmin: async () => state.integrations,
}));
vi.mock("@/server/services/microsoft", () => ({
  microsoftConnectionFor: async () => state.connection,
}));
vi.mock("@/server/services/microsoft-signin", () => ({
  microsoftSignInStatus: async () => state.signIn,
}));
vi.mock("@/server/services/posts", () => ({
  broadcastPolicyFor: async () => "ADMIN_PM",
}));
vi.mock("@/server/services/email", () => ({
  emailAvailable: () => state.emailAvailable,
}));
vi.mock("@/server/services/account-deletion", () => ({
  accountDeletionOptions: async () => ({ soleAdmin: false }),
}));
vi.mock("@/server/services/two-factor", () => ({
  twoFactorStatus: async () => ({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 }),
}));
vi.mock("@/server/services/email-preferences", () => ({
  emailPreferencesFor: async () => state.preferences,
}));
// The server actions are never pressed in a render; stubs keep the database out of the import.
vi.mock("@/components/actions", () => {
  const noop = async () => ({ ok: true, data: {} });
  return new Proxy({ __esModule: true } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : noop),
    has: () => true,
  });
});

const { default: IntegrationsPage } = await import("@/app/(app)/admin/integrations/page");
const { default: AccountPage } = await import("@/app/(app)/account/page");

async function integrationsHtml(params: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await IntegrationsPage({ searchParams: Promise.resolve(params) }));
}

async function accountHtml(): Promise<string> {
  return renderToStaticMarkup(await AccountPage());
}

/** Where each card title first appears, so their order can be compared. */
function positions(html: string, titles: string[]): number[] {
  return titles.map((title) => html.indexOf(`>${title}</h2>`));
}

beforeEach(reset);

/* ------------------------------------------------------------------ */
/* Admin → Integrations                                                */
/* ------------------------------------------------------------------ */

describe("Admin → Integrations", () => {
  it("lists Microsoft 365, then the Teams channel, then Slack, then the noticeboard", async () => {
    const html = await integrationsHtml();
    const order = positions(html, ["Microsoft 365", "Microsoft Teams channel", "Slack"]);

    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf("Slack</h2>")).toBeLessThan(html.indexOf("Announcements and the team board"));
    expect(html).toContain('id="microsoft-365"');
    // The chat card's title is the only thing renamed; nothing is titled plain "Microsoft Teams".
    expect(html).not.toContain(">Microsoft Teams</h2>");
    expect(html).toContain("Connect the Microsoft tools your team already uses");
    expect(html).toContain("items-start");
  });

  it("leaves Microsoft out entirely while no Azure app is registered, with no gap", async () => {
    state.connection = { ...state.connection, available: false };
    const html = await integrationsHtml();

    expect(html).not.toContain('id="microsoft-365"');
    expect(html).not.toContain(">Microsoft 365</h2>");
    expect(html).not.toContain("Sign in with Microsoft");
    expect(html).not.toContain("/api/auth/microsoft");
    const order = positions(html, ["Microsoft Teams channel", "Slack"]);
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]);
  });

  it("draws the Microsoft 365 card in two labelled parts, sign-in first", async () => {
    const html = await integrationsHtml();

    expect(html.indexOf(">Sign in with Microsoft</h3>")).toBeGreaterThan(0);
    expect(html.indexOf(">Sign in with Microsoft</h3>")).toBeLessThan(
      html.indexOf(">OneDrive and SharePoint files</h3>"),
    );
    // Off: the Switch on link, and the files part untouched.
    expect(html).toContain('href="/api/auth/microsoft/enable"');
    expect(html).toContain("Switch on");
    expect(html).toContain('href="/api/integrations/microsoft/connect"');
  });

  it("shows no Switch on button while the site's own address is not set", async () => {
    state.signIn = { ...state.signIn, callbackReady: false };
    const html = await integrationsHtml();

    expect(html).not.toContain('href="/api/auth/microsoft/enable"');
    expect(html).toContain("APP_BASE_URL");
  });

  it("reads company facts only when on: the domain, who and when, and a count", async () => {
    state.signIn = {
      enabled: true,
      domain: "contoso.com",
      enabledByName: "Salma Al Hinai",
      enabledAt: "2026-09-30T08:00:00.000Z",
      linkedPeople: 12,
      callbackReady: true,
    };
    const html = await integrationsHtml();

    expect(html).toContain("contoso.com");
    expect(html).toContain(`Salma Al Hinai on ${formatDate(new Date("2026-09-30T08:00:00.000Z"))}`);
    expect(html).toContain("12 people have signed in with Microsoft so far.");
    expect(html).toContain("Switch off");
    expect(html).not.toContain('href="/api/auth/microsoft/enable"');
  });

  it("says 'Linked' when the domain is unknown, and never names somebody who has left", async () => {
    state.signIn = {
      enabled: true,
      domain: null,
      enabledByName: null,
      enabledAt: "2026-09-30T08:00:00.000Z",
      linkedPeople: 0,
      callbackReady: true,
    };
    const html = await integrationsHtml();

    expect(html).toContain("Linked");
    expect(html).toContain(`Someone who has since left on ${formatDate(new Date("2026-09-30T08:00:00.000Z"))}`);
    expect(html).toContain("Nobody has signed in with Microsoft yet.");
  });

  it("turns each Switch on outcome into its plain sentence", async () => {
    state.signIn = { ...state.signIn, enabled: true, domain: "contoso.com" };
    expect(await integrationsHtml({ microsoftSignIn: "enabled" })).toContain(
      "Sign in with Microsoft is on for your company (contoso.com).",
    );

    state.signIn = { ...state.signIn, enabled: false, domain: null };
    const sentences: Record<string, string> = {
      denied: "The Microsoft sign-in was cancelled, so nothing was changed.",
      mismatch:
        "Sign in with the Microsoft account that uses the same email address as your Tielora account, then try again.",
      taken:
        "That Microsoft company is already linked to another Tielora workspace. If that is a mistake, contact Tielora support.",
      switchOffFirst: "Switch it off first, then switch it on with the Microsoft account you want.",
      failed: "Microsoft could not complete that. Try again.",
    };
    for (const [outcome, sentence] of Object.entries(sentences)) {
      expect(await integrationsHtml({ microsoftSignIn: outcome })).toContain(sentence);
    }
    // Anything else in the address is ignored.
    expect(await integrationsHtml({ microsoftSignIn: "<script>" })).not.toContain("&lt;script");
  });
});

/* ------------------------------------------------------------------ */
/* Your account → Email                                                */
/* ------------------------------------------------------------------ */

describe("Your account → Email", () => {
  it("is not drawn at all while email is not set up", async () => {
    state.preferences = { ...state.preferences, available: false };
    const html = await accountHtml();

    expect(html).not.toContain(">Email</h2>");
    expect(html).not.toContain("Email preferences");
    expect(html).not.toContain("Daily brief");
  });

  it("offers Alerts, Daily brief and Weekly brief, between two-factor and the danger zone", async () => {
    const html = await accountHtml();

    expect(html).toContain(">Email</h2>");
    expect(html).toContain("Emails go to");
    expect(html).toContain("salma@company.com");
    expect(html).toContain(">Alerts");
    expect(html).toContain(">Daily brief");
    expect(html).toContain(">Weekly brief");
    expect(html).toContain("Every email has a one-click unsubscribe link.");
    expect(html).toContain('<legend class="sr-only">Email preferences</legend>');
    expect(html.match(/type="checkbox"/g) ?? []).toHaveLength(3);

    const email = html.indexOf(">Email</h2>");
    expect(html.indexOf("Two-factor authentication")).toBeLessThan(email);
    expect(email).toBeLessThan(html.indexOf("Delete my account"));
  });

  it("shows a contractor the Alerts row only, with their own words", async () => {
    state.role = "EXTERNAL";
    const html = await accountHtml();

    expect(html).toContain(">Alerts");
    expect(html).toContain("An email for work assigned to you");
    expect(html).not.toContain("Daily brief");
    expect(html).not.toContain("Weekly brief");
    expect(html).not.toContain("company announcements");
    expect(html.match(/type="checkbox"/g) ?? []).toHaveLength(1);
  });

  it("greys the rows out until the address is confirmed, and offers the link again", async () => {
    state.preferences = { ...state.preferences, verified: false };
    const html = await accountHtml();

    expect(html).toContain(
      "Confirm your email address first — we only send these to an address you have confirmed.",
    );
    expect(html).toContain("Send me a confirmation email");
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    // The stored choice is still visible: a new account's Alerts shows as on.
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
  });
});
