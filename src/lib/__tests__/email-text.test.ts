// The words and layout of alert and brief emails. Pure, so proved without a database.
//
// The rules: typed web addresses never survive into an email as live links, right-to-left text
// around them is left exactly as it was, a subject is one clean line, and the daily brief follows
// the page's own order with its cap and "and N more".

import { describe, expect, it } from "vitest";
import {
  EMAIL_BODY_MAX_CHARS,
  LINK_REMOVED,
  briefIsEmpty,
  dailyBriefBody,
  dailyBriefSubject,
  emailBodyText,
  emailLayout,
  emailSubject,
  neutraliseLinks,
} from "@/lib/email-text";
import type { BriefDTO, BriefItemDTO } from "@/lib/zod-schemas";

describe("typed web addresses", () => {
  it("replaces http, https and www runs, whatever their case", () => {
    expect(neutraliseLinks("Sign in at https://evil.example/login?x=1 now")).toBe(
      `Sign in at ${LINK_REMOVED} now`,
    );
    expect(neutraliseLinks("see http://a.b and WWW.Evil.Example")).toBe(
      `see ${LINK_REMOVED} and ${LINK_REMOVED}`,
    );
    expect(neutraliseLinks("HTTPS://EVIL.EXAMPLE")).toBe(LINK_REMOVED);
  });

  it("gives back the punctuation that ends the sentence", () => {
    expect(neutraliseLinks("Go to https://evil.example.")).toBe(`Go to ${LINK_REMOVED}.`);
    expect(neutraliseLinks('"Visit www.evil.example" is due')).toBe(`"Visit ${LINK_REMOVED}" is due`);
  });

  it("leaves ordinary text alone", () => {
    expect(neutraliseLinks("Rev (B) — 12.4 flare tip, http status ok")).toBe(
      "Rev (B) — 12.4 flare tip, http status ok",
    );
  });

  it("never damages right-to-left text around a link", () => {
    const arabic = "فحص رأس الشعلة";
    expect(neutraliseLinks(`${arabic} https://evil.example ${arabic}`)).toBe(
      `${arabic} ${LINK_REMOVED} ${arabic}`,
    );
    // Written straight after the address with no space, the Arabic still survives whole.
    expect(neutraliseLinks(`https://evil.example${arabic}`)).toBe(`${LINK_REMOVED}${arabic}`);
    expect(neutraliseLinks(`${arabic}www.evil.example`)).toBe(`${arabic}${LINK_REMOVED}`);
  });
});

describe("subject and body", () => {
  it("makes a subject one clean line with no control characters", () => {
    expect(emailSubject("New task\r\nBcc: someone@evil.example\u0007")).toBe(
      "New task Bcc: someone@evil.example",
    );
    expect(emailSubject("")).toBe("Tielora");
  });

  it("caps a body at the chat length and keeps its newlines", () => {
    expect(emailBodyText("x".repeat(5_000))).toHaveLength(EMAIL_BODY_MAX_CHARS);
    expect(emailBodyText("one\ntwo\u0000")).toBe("one\ntwo");
  });

  it("lays every alert out on the same fixed skeleton", () => {
    const text = emailLayout({
      kind: "Alert",
      body: "You were given “Flare tip inspection”.",
      openLabel: "Open it in Tielora:",
      openLink: "https://tielora.example/discipline-tasks/abc",
      footer: {
        unsubscribePage: "https://tielora.example/unsubscribe?t=T",
        account: "https://tielora.example/account",
      },
    });
    expect(text.split("\n")).toEqual([
      "Tielora — Alert",
      "",
      "You were given “Flare tip inspection”.",
      "",
      "Open it in Tielora:",
      "https://tielora.example/discipline-tasks/abc",
      "",
      "--",
      "Stop emails like this one: https://tielora.example/unsubscribe?t=T",
      "Change all your email settings: https://tielora.example/account",
      "Sent by Tielora because you asked for these emails.",
    ]);
  });
});

const empty = { items: [], total: 0 };

function item(title: string, extra: Partial<BriefItemDTO> = {}): BriefItemDTO {
  return {
    id: "x",
    title,
    linkUrl: "/discipline-tasks/x",
    projectCode: "SUR-EXP",
    disciplineCode: "MECH",
    deadline: new Date("2026-09-12T00:00:00Z"),
    daysOverdue: null,
    body: null,
    note: null,
    at: null,
    ...extra,
  };
}

function brief(overrides: Partial<BriefDTO> = {}): BriefDTO {
  return {
    generatedAt: new Date("2026-09-30T06:00:00Z"),
    since: new Date("2026-09-29T06:00:00Z"),
    dueToday: empty,
    overdue: empty,
    newlyUnblocked: empty,
    mentions: empty,
    awaitingReview: empty,
    announcements: empty,
    awaitingAcknowledgement: empty,
    ...overrides,
  };
}

describe("the daily brief", () => {
  const now = new Date("2026-09-30T06:00:00Z");

  it("knows an empty day", () => {
    expect(briefIsEmpty(brief())).toBe(true);
    expect(briefIsEmpty(brief({ mentions: { items: [item("A")], total: 1 } }))).toBe(false);
  });

  it("names the day and the counts in the subject, leaving empty parts out", () => {
    const due = { items: [item("A"), item("B")], total: 2 };
    const late = { items: [item("C", { daysOverdue: 5 })], total: 1 };
    expect(dailyBriefSubject(brief({ dueToday: due, overdue: late }), now)).toBe(
      "Your day — 30 Sep 2026 (2 due today, 1 overdue)",
    );
    expect(dailyBriefSubject(brief({ overdue: late }), now)).toBe("Your day — 30 Sep 2026 (1 overdue)");
    expect(dailyBriefSubject(brief({ mentions: late }), now)).toBe("Your day — 30 Sep 2026");
  });

  it("writes one block per non-empty section, in the page's order, capped with 'and N more'", () => {
    const many = Array.from({ length: 10 }, (_, index) => item(`Task ${index + 1}`, { daysOverdue: 5 }));
    const body = dailyBriefBody(
      brief({
        overdue: { items: many, total: 13 },
        dueToday: { items: [item("Flare tip https://evil.example")], total: 1 },
      }),
    );
    const lines = body.split("\n");
    expect(lines[0]).toBe("DUE TODAY (1)");
    expect(lines[1]).toBe(`- Flare tip ${LINK_REMOVED} (SUR-EXP) — 12 Sep 2026`);
    expect(lines[3]).toBe("OVERDUE (13)");
    expect(lines[4]).toBe("- Task 1 (SUR-EXP) — 12 Sep 2026 — 5 days over");
    expect(lines).toContain("and 3 more — open Tielora to see them");
    expect(lines.filter((line) => line.startsWith("- Task"))).toHaveLength(10);
    expect(body).not.toContain("MENTIONS");
  });
});
