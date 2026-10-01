// Ask Tielora's screens, drawn: the panel, the two entry points, the AI card on Admin → Integrations
// and the "AI this month" meter on Admin → Billing. Render tests like teams-app-screens.test.tsx:
// no database, no network, no browser.
//
//  1. Dormant (no `ai` data) draws NOTHING: no AI card, no meter. Not greyed out, not a gap.
//  2. The panel has the starters, the scope line, the Anthropic notice with its Privacy link, a
//     labelled box, a 44px Close with a hint, and the warning line is only ever drawn with an answer.
//  3. Every refusal is sorted the way the spec says (and the server's words are never replaced).
//  4. The card and the meter say what the spec says, including the cap-0 and at-the-allowance cases.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingStatusDTO, MicrosoftConnectionDTO, MicrosoftSignInStatusDTO } from "@/lib/zod-schemas";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
}));

import { AdminBillingView } from "@/components/admin/admin-billing-view";
import { AdminIntegrationsView } from "@/components/admin/admin-integrations-view";
import { AskTieloraDashboardCard, AskTieloraProjectButton } from "@/components/ai/ask-tielora-entry";
import { AskTieloraPanel, noticeFor } from "@/components/ai/ask-tielora-panel";
import type { AiCardData } from "@/server/services/ai-panel";

/** React puts comment markers between adjacent text pieces; a person never sees them. */
function plain(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

/* ------------------------------ the panel ------------------------------ */

const PROJECT = { kind: "project", id: "p1", code: "SUR-EXP", name: "Surge Export" } as const;
const PROJECTS = [
  { id: "p1", code: "SUR-EXP", name: "Surge Export" },
  { id: "p2", code: "GAS-TIE", name: "Gas Tie-in" },
];

describe("the Ask Tielora panel", () => {
  it("on a project page names the project, offers the three starters and a labelled box", () => {
    const html = plain(renderToStaticMarkup(<AskTieloraPanel scope={PROJECT} onClose={() => undefined} />));
    expect(html).toContain("Asking about SUR-EXP · Surge Export");
    for (const starter of ["What is blocking this project?", "What is late?", "What is the next gate waiting on?"]) {
      expect(html).toContain(starter);
    }
    expect(html).toContain("Not sure where to start? Try one of these.");
    expect(html).toContain("What would you like to know?");
    expect(html).toContain("Ask about your projects");
    expect(html).toContain('placeholder="For example: What is blocking this project?"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('title="Put this question in the box"');
    // Nothing to say about wrong answers until there is an answer.
    expect(html).not.toContain("Answers may be wrong");
  });

  it("says where the question goes, with a Privacy link, right under the box", () => {
    const html = plain(renderToStaticMarkup(<AskTieloraPanel scope={PROJECT} onClose={() => undefined} />));
    expect(html).toContain("Your question and this project’s details are sent to Anthropic to write the answer.");
    expect(html).toContain('href="/privacy"');
    expect(html.indexOf("Ask about your projects")).toBeLessThan(html.indexOf("sent to Anthropic"));
  });

  it("is a dialog with a 44px Close that has a name and a hint, and Send disabled while the box is empty", () => {
    const html = renderToStaticMarkup(<AskTieloraPanel scope={PROJECT} onClose={() => undefined} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('title="Close"');
    expect(html).toMatch(/h-11 w-11[^"]*"[^>]*>|aria-label="Close"[^>]*h-11 w-11|h-11 w-11[^>]*aria-label="Close"/);
    expect(html).toMatch(/<button[^>]*title="Send your question \(Ctrl\+Enter\)"[^>]*disabled/);
  });

  it("on the dashboard lets the person choose All my projects or one of their own, and uses the dashboard starters", () => {
    const html = plain(
      renderToStaticMarkup(<AskTieloraPanel scope={{ kind: "dashboard", projects: PROJECTS }} onClose={() => undefined} />),
    );
    expect(html).toContain("Ask about");
    expect(html).toContain('title="Choose which of your projects the question covers"');
    expect(html).toContain("All my projects");
    expect(html).toContain("SUR-EXP · Surge Export");
    expect(html).toContain("GAS-TIE · Gas Tie-in");
    expect(html).toContain("What is blocked across my projects?");
    expect(html).toContain("Which project is furthest behind?");
    expect(html).toContain('placeholder="For example: What is late across my projects?"');
  });

  it("holds no link or image of its own other than Privacy, so an answer can only ever be printed as text", () => {
    const html = renderToStaticMarkup(<AskTieloraPanel scope={PROJECT} onClose={() => undefined} />);
    expect(html.match(/<a /g) ?? []).toHaveLength(1);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("how a refusal is sorted (the server's words are shown as they arrive)", () => {
  it("shows the administrator's allowance sentence with an Open Billing door, and locks asking", () => {
    const sentence = "Your company has used its AI allowance for this month. See Admin → Billing.";
    const { notice } = noticeFor(402, sentence, 0);
    expect(notice).toMatchObject({ tone: "neutral", kind: "cap", text: sentence, billingLink: true });
  });

  it("shows anyone else's allowance sentence with no door they cannot use", () => {
    const sentence = "Your company has used its AI allowance for this month. Ask your administrator.";
    const { notice } = noticeFor(402, sentence, 0);
    expect(notice).toMatchObject({ tone: "neutral", kind: "cap", text: sentence });
    expect(notice.billingLink).toBeFalsy();
  });

  it("keeps 'I can't find that project.' calm, and 'not switched on' calm and locked", () => {
    expect(noticeFor(404, "I can't find that project.", 0).notice).toMatchObject({ tone: "neutral", kind: "notFound" });
    expect(noticeFor(400, "Ask Tielora is not switched on for your company.", 0).notice).toMatchObject({
      tone: "neutral",
      kind: "off",
    });
    expect(noticeFor(400, "Ask Tielora is not set up.", 0).notice).toMatchObject({ tone: "neutral", kind: "off" });
  });

  it("counts down a rate limit from Retry-After, never for more than a minute", () => {
    const sentence = "You are asking quickly. Try again in a moment.";
    expect(noticeFor(429, sentence, 12)).toMatchObject({ wait: 12, notice: { kind: "rate", text: sentence } });
    expect(noticeFor(429, sentence, 500).wait).toBe(60);
    expect(noticeFor(429, sentence, Number.NaN).wait).toBeGreaterThan(0);
  });

  it("treats anything else as a red error with a Try again, in the server's words", () => {
    const sentence = "Ask Tielora could not answer just now. Try again in a minute.";
    expect(noticeFor(502, sentence, 0).notice).toMatchObject({ tone: "error", kind: "retry", text: sentence });
    expect(noticeFor(500, null, 0).notice).toMatchObject({ tone: "error", kind: "retry", text: sentence });
  });
});

/* ------------------------------ the doors ------------------------------ */

describe("the entry points", () => {
  it("puts a secondary, 44px, sparkle-and-words Ask Tielora button in the project header", () => {
    const html = renderToStaticMarkup(<AskTieloraProjectButton project={PROJECT} />);
    expect(html).toContain("Ask Tielora");
    expect(html).toContain('title="Ask a question about this project"');
    expect(html).toContain("min-h-11");
    expect(html).toContain('aria-expanded="false"');
    // Closed by default: the panel only exists once pressed.
    expect(html).not.toContain('role="dialog"');
  });

  it("draws the dashboard launcher card with its heading, line and button", () => {
    const html = renderToStaticMarkup(<AskTieloraDashboardCard projects={PROJECTS} />);
    expect(html).toContain("Ask Tielora");
    expect(html).toContain("Ask a question about your projects, like what is blocking them.");
    expect(html).toContain("Ask a question");
    expect(html).toContain('title="Ask a question about your projects"');
    expect(html).not.toContain('role="dialog"');
  });
});

/* ------------------------- Admin → Integrations ------------------------- */

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

const CONNECTION: MicrosoftConnectionDTO = {
  available: true,
  callbackReady: true,
  connected: false,
  tenantDomain: null,
  connectedByName: null,
  connectedAt: null,
  needsReconnect: false,
};

const SIGN_IN: MicrosoftSignInStatusDTO = {
  enabled: false,
  domain: null,
  enabledByName: null,
  enabledAt: null,
  linkedPeople: 0,
  callbackReady: true,
};

function card(options: Partial<{ aiAssistant: boolean; aiBriefs: boolean; monthlyUsd: number; usedUsd: number }> = {}): AiCardData {
  return {
    settings: {
      configured: true,
      aiAssistant: options.aiAssistant ?? false,
      aiBriefs: options.aiBriefs ?? false,
      monthlyUsd: options.monthlyUsd ?? 2,
    },
    usedUsd: options.usedUsd ?? 0.42,
    atAllowance: (options.monthlyUsd ?? 2) > 0 && (options.usedUsd ?? 0.42) + 0.04 > (options.monthlyUsd ?? 2),
    resetsOn: new Date("2026-11-01T00:00:00.000Z"),
  };
}

function integrations(ai?: AiCardData | null): string {
  return plain(
    renderToStaticMarkup(
      <AdminIntegrationsView
        integrations={[
          { kind: "SLACK", configured: false, enabled: false, webhookUrlMasked: null, eventToggles: TOGGLES, updatedAt: null },
          { kind: "TEAMS", configured: false, enabled: false, webhookUrlMasked: null, eventToggles: TOGGLES, updatedAt: null },
        ]}
        microsoft={CONNECTION}
        microsoftSignIn={SIGN_IN}
        emailAvailable
        broadcastPolicy="ADMIN_ONLY"
        {...(ai === undefined ? {} : { ai })}
      />,
    ),
  );
}

describe("Admin → Integrations: the AI card", () => {
  it("is not drawn at all while there is no AI key (and by default)", () => {
    for (const html of [integrations(), integrations(null)]) {
      expect(html).not.toContain("What is sent to Anthropic");
      expect(html).not.toContain("AI-written briefs");
      expect(html).not.toContain("Ask Tielora");
    }
  });

  it("sits after the chat cards, with both switches off and the badge Off", () => {
    const html = integrations(card());
    expect(html.indexOf("Slack")).toBeGreaterThan(-1);
    expect(html.indexOf('id="ai"')).toBeGreaterThan(html.indexOf("Microsoft Teams channel"));
    expect(html).toContain("Ask Tielora");
    expect(html).toContain("AI-written briefs");
    expect(html).toContain("Both are off until you switch them on.");
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain(">Off<");
  });

  it("says what is sent to Anthropic, links to Privacy and Billing, and states the allowance", () => {
    const html = integrations(card());
    expect(html).toContain("What is sent to Anthropic");
    expect(html).toContain("People’s names, email addresses, comments and documents are never sent.");
    expect(html).toContain("Tielora does not save questions or answers.");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Read our Privacy page");
    expect(html).toContain('href="/admin/billing"');
    expect(html).toContain("Your plan’s monthly allowance is $2.00. Used so far this month: $0.42.");
    expect(html).not.toContain("used its AI allowance");
  });

  it("shows the badge On and the boxes ticked when the switches are on", () => {
    const html = integrations(card({ aiAssistant: true, aiBriefs: true }));
    expect(html).toContain(">On<");
    expect(html.match(/type="checkbox"[^>]*checked/g) ?? []).toHaveLength(2);
  });

  it("asks nothing until a switch is pressed: no confirm dialog is drawn", () => {
    expect(integrations(card())).not.toContain("Turn on Ask Tielora?");
  });

  it("at the allowance, adds the calm note with the reset date", () => {
    const html = integrations(card({ usedUsd: 1.97 }));
    expect(html).toContain("Your company has used its AI allowance for this month.");
    expect(html).toContain("start working again on 1 Nov 2026.");
  });

  it("with no AI in the plan, draws no switches, says so, and still points at Billing", () => {
    const html = integrations(card({ monthlyUsd: 0, usedUsd: 0 }));
    expect(html).toContain("Your plan doesn’t include AI. There is nothing to switch on.");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('href="/admin/billing"');
  });
});

/* --------------------------- Admin → Billing --------------------------- */

function status(ai?: BillingStatusDTO["ai"]): BillingStatusDTO {
  return {
    plan: "FREE",
    usage: { projects: 1, users: 3, documentBytes: 1024 },
    limits: { projects: 1, users: 10, documentBytes: 500 * 1024 * 1024, aiMonthlyUsd: 2 },
    provider: { configured: false, hasSubscription: false, paymentIssue: false },
    ...(ai ? { ai } : {}),
  } as BillingStatusDTO;
}

function billing(ai?: BillingStatusDTO["ai"]): string {
  return plain(renderToStaticMarkup(<AdminBillingView status={status(ai)} />));
}

describe("Admin → Billing: the AI this month meter", () => {
  const RESET = new Date("2026-11-01T00:00:00.000Z");

  it("is absent when the status carries no AI block (no key): the page is unchanged", () => {
    const html = billing();
    expect(html).not.toContain("AI this month");
    expect(html).not.toContain("AI request");
  });

  it("shows dollars used against the allowance, the request count and the reset date", () => {
    const html = billing({ usedUsd: 0.42, requests: 15, capUsd: 2, atAllowance: false, resetsOn: RESET });
    expect(html).toContain("AI this month");
    expect(html).toContain("$0.42 / $2.00");
    expect(html).toContain("15 AI requests this month · Resets on 1 Nov 2026");
    expect(html).not.toContain("You have used this month’s AI allowance");
  });

  it("sits directly under Documents", () => {
    const html = billing({ usedUsd: 0, requests: 0, capUsd: 2, atAllowance: false, resetsOn: RESET });
    expect(html.indexOf("AI this month")).toBeGreaterThan(html.indexOf("Documents"));
  });

  it("at the allowance, turns red and says so in words", () => {
    const html = billing({ usedUsd: 1.97, requests: 40, capUsd: 2, atAllowance: true, resetsOn: RESET });
    expect(html).toContain("You have used this month’s AI allowance.");
    expect(html).toContain("paused until 1 Nov 2026. Everything else works as normal.");
    expect(html).toContain("var(--status-blocked)");
  });

  it("with no allowance in the plan, draws a plain row and no bar", () => {
    const html = billing({ usedUsd: 0, requests: 0, capUsd: 0, atAllowance: false, resetsOn: RESET });
    expect(html).toContain("Not included in your plan");
    expect(html).not.toContain("$0.00 / $0.00");
  });
});
