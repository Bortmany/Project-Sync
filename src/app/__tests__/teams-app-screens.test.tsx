// The Teams app's three screens, drawn: the Admin → Integrations card, the signed-in tab and the
// sign-in state. Render tests like microsoft-first-screens.test.tsx — no database, no network.
//
//  1. The card is absent while the deployment has not set the Teams app up, and sits straight after
//     the Microsoft 365 card and before the "Microsoft Teams channel" card once it has.
//  2. An administrator whose company has not switched on Sign in with Microsoft still sees the card,
//     with the notice; once it is on, the badge says Ready and the notice goes.
//  3. The signed-in tab is read-only: no form, no button; every row is a link that opens in the
//     browser; a contractor's notice is plain text with no link.
//  4. The sign-in state: a checking state, and the "open Tielora in your browser" message.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  BriefDTO,
  MicrosoftConnectionDTO,
  MicrosoftSignInStatusDTO,
  OrgIntegrationDTO,
} from "@/lib/zod-schemas";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
}));

import { AdminIntegrationsView } from "@/components/admin/admin-integrations-view";
import { AUTH_END_OUTSIDE_TEAMS, AuthEndView } from "@/components/teams/auth-end-view";
import { TeamsBrief } from "@/components/teams/teams-brief";
import { TeamsSignIn } from "@/components/teams/teams-sign-in";

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
  return { kind, configured: false, enabled: false, webhookUrlMasked: null, eventToggles: TOGGLES, updatedAt: null };
}

const CONNECTION: MicrosoftConnectionDTO = {
  available: true,
  callbackReady: true,
  connected: false,
  tenantDomain: null,
  connectedByName: null,
  connectedAt: null,
  needsReconnect: false,
};

function signIn(enabled: boolean): MicrosoftSignInStatusDTO {
  return {
    enabled,
    domain: enabled ? "contoso.com" : null,
    enabledByName: enabled ? "Salma Al Hinai" : null,
    enabledAt: enabled ? "2026-09-30T08:00:00.000Z" : null,
    linkedPeople: 0,
    callbackReady: true,
  };
}

function integrations(options: { teamsApp?: boolean; signInOn?: boolean } = {}): string {
  return renderToStaticMarkup(
    <AdminIntegrationsView
      integrations={[chat("SLACK"), chat("TEAMS")]}
      microsoft={CONNECTION}
      microsoftSignIn={signIn(options.signInOn ?? false)}
      emailAvailable
      broadcastPolicy="ADMIN_ONLY"
      {...(options.teamsApp === undefined ? {} : { teamsApp: options.teamsApp })}
    />,
  );
}

describe("Admin → Integrations: the Microsoft Teams app card", () => {
  it("is not drawn at all while the Teams app is not set up (and by default)", () => {
    for (const html of [integrations(), integrations({ teamsApp: false })]) {
      expect(html).not.toContain("Microsoft Teams app");
      expect(html).not.toContain("Download Tielora for Teams");
    }
  });

  it("sits after the Microsoft 365 card and before the Teams channel card", () => {
    const html = integrations({ teamsApp: true });
    const microsoft = html.indexOf("Microsoft 365");
    const app = html.indexOf("Microsoft Teams app");
    const channel = html.indexOf("Microsoft Teams channel");
    expect(microsoft).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(microsoft);
    expect(channel).toBeGreaterThan(app);
  });

  it("still shows to a company without Microsoft sign-in, with the notice and a link to that card", () => {
    const html = integrations({ teamsApp: true, signInOn: false });
    expect(html).toContain("Needs Microsoft sign-in");
    expect(html).toContain("People cannot sign in inside Teams until you switch on Sign in with Microsoft.");
    expect(html).toContain('href="#microsoft-365"');
    expect(html).toContain("Download Tielora for Teams");
    expect(html).toContain("This file is the same for everyone at your company. It contains no passwords or secrets.");
  });

  it("says Ready and drops the notice once Microsoft sign-in is on", () => {
    const html = integrations({ teamsApp: true, signInOn: true });
    expect(html).toContain("Ready");
    expect(html).not.toContain("Needs Microsoft sign-in");
    expect(html).not.toContain("People cannot sign in inside Teams");
  });

  it("carries the step-by-step instructions, closed by default, with a hint on the summary", () => {
    const html = integrations({ teamsApp: true });
    expect(html).toContain("How to add it to Teams");
    expect(html).toContain("Upload a custom app");
    expect(html).toContain("Teams admin centre");
    expect(html).toContain('title="Step-by-step instructions for adding Tielora to Teams"');
    expect(html).not.toMatch(/<details[^>]* open/);
  });
});

/* ------------------------------ the tab ------------------------------ */

const EMPTY = { items: [], total: 0 };

function item(overrides: Partial<BriefDTO["dueToday"]["items"][number]>) {
  return {
    id: "id-1",
    title: "Weld inspection",
    linkUrl: "/discipline-tasks/abc",
    projectCode: "SUR-EXP",
    disciplineCode: "MECH",
    deadline: new Date("2026-09-30T00:00:00.000Z"),
    daysOverdue: null,
    body: null,
    note: null,
    at: null,
    ...overrides,
  };
}

function brief(overrides: Partial<BriefDTO>): BriefDTO {
  return {
    generatedAt: new Date("2026-09-30T08:00:00.000Z"),
    since: new Date("2026-09-29T08:00:00.000Z"),
    dueToday: EMPTY,
    overdue: EMPTY,
    newlyUnblocked: EMPTY,
    mentions: EMPTY,
    awaitingReview: EMPTY,
    announcements: EMPTY,
    awaitingAcknowledgement: EMPTY,
    ...overrides,
  } as BriefDTO;
}

describe("the signed-in tab", () => {
  it("is read-only: no form, no button; every row is a link; one 'open in your browser' line", () => {
    const html = renderToStaticMarkup(
      <TeamsBrief brief={brief({ dueToday: { items: [item({})], total: 1 } })} contractor={false} />,
    );

    expect(html).toContain("Your day");
    expect(html).toContain("Weld inspection");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).toContain('href="/discipline-tasks/abc"');
    expect(html).toContain('title="Opens in Tielora in your browser"');
    expect(html).toContain("(opens in your browser)");
    expect(html).toContain("Open Tielora in your browser");
    expect(html).toContain('href="/my-tasks/brief"');
    // No second login, no sign-out.
    expect(html.toLowerCase()).not.toContain("sign out");
  });

  it("caps nothing itself but states the true total when the list was capped", () => {
    const html = renderToStaticMarkup(
      <TeamsBrief brief={brief({ overdue: { items: [item({ daysOverdue: 2 })], total: 13 } })} contractor={false} />,
    );
    expect(html).toContain("Overdue (13)");
    expect(html).toContain("12 more not shown.");
  });

  it("shows a contractor 'Notices' as plain text with the body and no link", () => {
    const html = renderToStaticMarkup(
      <TeamsBrief
        brief={brief({
          announcements: {
            items: [item({ title: "Gate 4 closed", linkUrl: "", body: "Use gate 2 instead.", deadline: null })],
            total: 1,
          },
        })}
        contractor
      />,
    );

    expect(html).toContain("Notices (1)");
    expect(html).not.toContain("Announcements (");
    expect(html).toContain("Gate 4 closed");
    expect(html).toContain("Use gate 2 instead.");
    expect(html).not.toMatch(/<a [^>]*href="\/messages/);
    // The only link on the page is the one at the bottom.
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it("says so in one sentence when nothing needs the person today", () => {
    const html = renderToStaticMarkup(<TeamsBrief brief={brief({})} contractor={false} />);
    expect(html).toContain("Nothing due today, nothing overdue");
  });
});

describe("the privacy page", () => {
  it("says, in one sentence, that Teams uses a separate sign-in cookie that only works within Teams", async () => {
    const { default: PrivacyPage } = await import("@/app/(public)/privacy/page");
    const html = renderToStaticMarkup(PrivacyPage());
    expect(html).toContain(
      "Inside Microsoft Teams, Tielora uses a separate sign-in cookie that only works within Teams.",
    );
  });
});

describe("the Microsoft sign-in window's last stop", () => {
  it("shows a spinner and 'Signing you in…' while it hands the code over", () => {
    const html = renderToStaticMarkup(<AuthEndView outsideTeams={false} />);
    expect(html).toContain("Signing you in…");
    expect(html).not.toContain(AUTH_END_OUTSIDE_TEAMS);
  });

  it("says to close the window and try again from Teams when it was opened outside Teams", () => {
    const html = renderToStaticMarkup(<AuthEndView outsideTeams />);
    expect(html).toContain("Close this window and try again from Teams.");
    expect(html).not.toContain("Signing you in");
  });
});

describe("the tab while nobody is signed in", () => {
  it("starts in a checking state with skeleton rows — never a blank screen", () => {
    const html = renderToStaticMarkup(<TeamsSignIn cookiesBlocked={false} />);
    expect(html).toContain("Your day");
    expect(html).toContain("Signing you in…");
  });

  it("says to open Tielora in the browser when the sign-in cannot be kept", () => {
    const html = renderToStaticMarkup(<TeamsSignIn cookiesBlocked />);
    expect(html).toContain("Open Tielora in your browser");
    expect(html).toContain("Your browser is blocking Tielora inside Teams. Open Tielora in your browser instead.");
    expect(html).toContain("Open Tielora");
    expect(html).toContain('title="Opens Tielora in your browser"');
  });
});
