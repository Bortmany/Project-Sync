// Service-level tests for the chat integrations (Slack and Microsoft Teams).
//
// The rules being proved: only the two documented hosts are ever accepted, a saved webhook address
// is never handed back to anyone and never written to an audit row or a log line, only the events a
// company switched on are delivered, a "too many requests" answer is retried exactly once at the
// pace the chat tool asked for, and removing a connection removes the address.
//
// No test here touches the network: global.fetch is replaced for every case that delivers.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ForbiddenError } from "@/lib/permissions";
import {
  DEFAULT_EVENT_TOGGLES,
  IntegrationEventToggles,
  SaveIntegrationInput,
  maskWebhookUrl,
  webhookUrlProblem,
} from "@/lib/zod-schemas";
import { NotFoundError } from "@/server/errors";
import {
  deleteIntegration,
  integrationCounts,
  listIntegrationsForAdmin,
  saveIntegration,
  sendIntegrationTest,
  setEventToggles,
  setIntegrationEnabled,
} from "@/server/services/integrations";
import {
  buildPayload,
  deliverToOrgWebhooks,
  postToWebhook,
  retryAfterMs,
  toggleForType,
  type WebhookEvent,
} from "@/server/services/webhooks";
import { notify } from "@/server/services/notify";
import type { SweepWebhookEvent } from "@/server/services/notifications";
import {
  CHAT_DELIVERY_BUDGET_MS,
  MAX_CHAT_REMINDERS_PER_ORG,
  deliverSweepReminders,
} from "@/server/sweep";
import {
  makeOrg,
  makeProjectFixture,
  resetDatabase,
  type Fixture,
} from "@/server/__tests__/harness";

// Alert and brief emails — the email copy of the same fan-out, per person.
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";
import { actorForUser } from "@/server/actor";
import {
  ALERT_EMAILS_PER_HOUR,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/server/services/email";
import { setEmailPreferences } from "@/server/services/email-preferences";
import { createMainTask } from "@/server/services/tasks";
import { requestWorkspaceDeletion } from "@/server/services/workspace-deletion";
import {
  emailSweepReminders,
  postWeeklyBriefs,
  runSweepOnce,
  sendDailyBriefEmails,
  sendWeeklyBriefEmails,
} from "@/server/sweep";
import { weeklyBoundary } from "@/server/services/weekly-brief";
import { inThirtyDays, makeUser } from "@/server/__tests__/harness";
import {
  EMAIL_BASE,
  configureEmail,
  goDormant,
  mockFetchOk as mockEmailFetchOk,
  optIn,
  sentEmails,
  settle,
} from "@/server/__tests__/email-harness";

process.env.SWEEP_DISABLED = "1";

const SLACK_URL = "https://hooks.slack.com/services/T00000000/B00000000/Sup3rSecretT0kenValue";
const TEAMS_URL =
  "https://prod-07.westeurope.logic.azure.com:443/workflows/9f3/triggers/manual/paths/invoke?api-version=2016-06-01&sv=1.0&sig=Sup3rSecretSignatureValue";

const ASSIGNED_EVENT: WebhookEvent = {
  type: "ASSIGNED",
  title: "New task assigned to you",
  body: "You were given “Flare tip inspection”.",
  linkUrl: "/discipline-tasks/abc123",
};

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Replaces the network with a spy that always answers 200 OK, like a real webhook does. */
function mockFetchOk() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
}

/** A connected, switched-on channel with every event on. */
async function connect(kind: "SLACK" | "TEAMS", url: string) {
  await saveIntegration(fixture.adminActor, { kind, webhookUrl: url });
  await setIntegrationEnabled(fixture.adminActor, { kind, enabled: true });
}

describe("validating a pasted address", () => {
  it("accepts the documented shape for each kind", () => {
    expect(webhookUrlProblem("SLACK", SLACK_URL)).toBeNull();
    expect(webhookUrlProblem("TEAMS", TEAMS_URL)).toBeNull();
  });

  it("refuses the other kind's address, in plain English", () => {
    expect(webhookUrlProblem("SLACK", TEAMS_URL)).toMatch(/hooks\.slack\.com/);
    expect(webhookUrlProblem("TEAMS", SLACK_URL)).toMatch(/logic\.azure\.com/);
  });

  it("refuses anything that is not https on the right host", () => {
    expect(webhookUrlProblem("SLACK", "http://hooks.slack.com/services/T/B/X")).toBe(
      "The address must start with https://",
    );
    expect(webhookUrlProblem("SLACK", "https://hooks.slack.com.evil.example/services/T/B/X")).not.toBeNull();
    expect(webhookUrlProblem("TEAMS", "https://logic.azure.com.evil.example/workflows/x/triggers/y")).not.toBeNull();
    expect(webhookUrlProblem("SLACK", "https://169.254.169.254/services/T/B/X")).not.toBeNull();
    expect(webhookUrlProblem("SLACK", "https://user:pass@hooks.slack.com/services/T/B/X")).toBe(
      "Remove the username and password from the address.",
    );
    // A port nobody's chat webhook listens on is refused rather than dialled. Teams addresses are
    // written with ":443", which is the default and which the parser drops, so they still pass.
    expect(webhookUrlProblem("SLACK", "https://hooks.slack.com:8443/services/T/B/X")).toBe(
      "Remove the port number from the address.",
    );
    expect(webhookUrlProblem("SLACK", "https://hooks.slack.com:443/services/T/B/X")).toBeNull();
    expect(webhookUrlProblem("SLACK", "not a web address")).toBe(
      "Paste the whole web address, starting with https://",
    );
    // Right host, but not a webhook path.
    expect(webhookUrlProblem("SLACK", "https://hooks.slack.com/")).not.toBeNull();
  });

  it("is enforced by the input schema, on the webhookUrl field", () => {
    const parsed = SaveIntegrationInput.safeParse({ kind: "SLACK", webhookUrl: TEAMS_URL });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(["webhookUrl"]);
    }
  });

  it("is enforced again in the service, whatever the caller parsed", async () => {
    await expect(
      saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: TEAMS_URL }),
    ).rejects.toThrow(/hooks\.slack\.com/);
  });

  it("is refused outright to anyone who is not an administrator", async () => {
    await expect(
      saveIntegration(fixture.pmActor, { kind: "SLACK", webhookUrl: SLACK_URL }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listIntegrationsForAdmin(fixture.engineerActor)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("what the admin screen is told", () => {
  it("shows a card for each kind before anything is configured", async () => {
    const list = await listIntegrationsForAdmin(fixture.adminActor);
    expect(list.map((item) => item.kind)).toEqual(["SLACK", "TEAMS"]);
    expect(list.every((item) => !item.configured && !item.enabled)).toBe(true);
    expect(list.every((item) => item.webhookUrlMasked === null)).toBe(true);
  });

  it("NEVER returns the saved address — only its scheme and host", async () => {
    await saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
    const list = await listIntegrationsForAdmin(fixture.adminActor);
    const slack = list.find((item) => item.kind === "SLACK");

    expect(slack?.configured).toBe(true);
    expect(slack?.webhookUrlMasked).toBe("https://hooks.slack.com/…");
    expect(JSON.stringify(list)).not.toContain("Sup3rSecretT0kenValue");
    expect(JSON.stringify(list)).not.toContain("/services/");
  });

  it("masks a Teams address the same way, port and signature gone", async () => {
    expect(maskWebhookUrl(TEAMS_URL)).toBe("https://prod-07.westeurope.logic.azure.com/…");
  });

  it("keeps the events a company chose when the address is replaced", async () => {
    await saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
    const chosen = {
      taskAssigned: false,
      mention: false,
      statusChange: true,
      overdueReminder: false,
      gateOverride: true,
      announcements: false,

      dailyBrief: false,

      weeklyBrief: false,
    };
    await setEventToggles(fixture.adminActor, { kind: "SLACK", eventToggles: chosen });

    // Pasting a fresh address is not consent to start sending the four things they switched off.
    const replaced = await saveIntegration(fixture.adminActor, {
      kind: "SLACK",
      webhookUrl: "https://hooks.slack.com/services/TNEW/BNEW/AnotherSecretTokenValue",
    });

    expect(replaced.eventToggles).toEqual(chosen);
  });

  it("starts switched off with the notification copies on and the digest off", async () => {
    const saved = await saveIntegration(fixture.adminActor, { kind: "TEAMS", webhookUrl: TEAMS_URL });
    expect(saved.enabled).toBe(false);
    expect(saved.eventToggles).toEqual({
      taskAssigned: true,
      mention: true,
      statusChange: true,
      overdueReminder: true,
      gateOverride: true,
      // The announcement copy and the daily digest are both posts into somebody's channel that
      // nobody asked for yet, so both only ever happen because an administrator switched them on.
      announcements: false,
      dailyBrief: false,
      weeklyBrief: false,
    });
  });

  it("keeps parsing a toggle map saved before the digest existed, and reads it as digest off", async () => {
    await saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
    // Exactly what rows written before this change hold: the five original keys and nothing else.
    await prisma.orgIntegration.updateMany({
      where: { orgId: fixture.orgId, kind: "SLACK" },
      data: {
        eventToggles: {
          taskAssigned: true,
          mention: true,
          statusChange: true,
          overdueReminder: true,
          gateOverride: true,
        },
      },
    });

    const cards = await listIntegrationsForAdmin(fixture.adminActor);
    const slack = cards.find((card) => card.kind === "SLACK");

    expect(slack?.eventToggles.taskAssigned).toBe(true);
    expect(slack?.eventToggles.dailyBrief).toBe(false);

    // And delivery still works — the missing key must never switch a company's chat off.
    const fetchSpy = mockFetchOk();
    await setIntegrationEnabled(fixture.adminActor, { kind: "SLACK", enabled: true });
    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the audit trail", () => {
  it("records the kind and the switches, and never the address", async () => {
    await connect("SLACK", SLACK_URL);
    await setEventToggles(fixture.adminActor, {
      kind: "SLACK",
      eventToggles: {
        taskAssigned: false,
        mention: true,
        statusChange: true,
        overdueReminder: true,
        gateOverride: true,
        announcements: false,

        dailyBrief: false,

        weeklyBrief: false,
      },
    });

    const rows = await prisma.activityLog.findMany({
      where: { entityType: "OrgIntegration" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.action).sort()).toEqual([
      "INTEGRATION_CONNECTED",
      "INTEGRATION_ENABLED",
      "INTEGRATION_EVENTS_CHANGED",
    ]);
    expect(JSON.stringify(rows)).not.toContain("Sup3rSecretT0kenValue");
    expect(JSON.stringify(rows)).not.toContain("hooks.slack.com");
    for (const row of rows) {
      expect(row.metadata).toMatchObject({ kind: "SLACK" });
    }
  });
});

describe("switching on, switching off and removing", () => {
  it("refuses to switch on a kind that has no address yet", async () => {
    await expect(
      setIntegrationEnabled(fixture.adminActor, { kind: "TEAMS", enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("counts only switched-on channels for /api/health, and nothing else", async () => {
    expect(await integrationCounts()).toEqual({ slack: 0, teams: 0 });

    await saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
    expect(await integrationCounts()).toEqual({ slack: 0, teams: 0 });

    await setIntegrationEnabled(fixture.adminActor, { kind: "SLACK", enabled: true });
    expect(await integrationCounts()).toEqual({ slack: 1, teams: 0 });
  });

  it("removes the address with the connection, and says so in the audit trail", async () => {
    await connect("SLACK", SLACK_URL);
    const removed = await deleteIntegration(fixture.adminActor, { kind: "SLACK" });

    expect(removed).toEqual({ removed: true });
    expect(await prisma.orgIntegration.count()).toBe(0);
    const audit = await prisma.activityLog.findFirst({ where: { action: "INTEGRATION_REMOVED" } });
    expect(audit).not.toBeNull();

    // Gone means gone: removing it twice is "not found", not an error page.
    await expect(deleteIntegration(fixture.adminActor, { kind: "SLACK" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("which events actually go out", () => {
  it("sends an event the company has switched on", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);

    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(SLACK_URL);
  });

  it("sends nothing while the channel is switched off", async () => {
    const fetchSpy = mockFetchOk();
    await saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });

    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends nothing for an event whose toggle is off", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);
    await setEventToggles(fixture.adminActor, {
      kind: "SLACK",
      eventToggles: {
        taskAssigned: false,
        mention: true,
        statusChange: true,
        overdueReminder: true,
        gateOverride: true,
        announcements: false,
        dailyBrief: false,
        weeklyBrief: false,
      },
    });

    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);
    expect(fetchSpy).not.toHaveBeenCalled();

    // A different event, still switched on, still goes.
    await deliverToOrgWebhooks(fixture.orgId, { ...ASSIGNED_EVENT, type: "MENTIONED" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for the kinds of notification chat does not carry", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);

    expect(toggleForType("DOCUMENT_UPLOADED")).toBeNull();
    expect(toggleForType("COMMENT_ADDED")).toBeNull();

    await deliverToOrgWebhooks(fixture.orgId, { ...ASSIGNED_EVENT, type: "COMMENT_ADDED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("carries an announcement only once the company switches announcements on", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);

    // The toggle is off by default, so company news does not walk into a chat channel by itself.
    expect(toggleForType("ANNOUNCEMENT")).toBe("announcements");
    await deliverToOrgWebhooks(fixture.orgId, { ...ASSIGNED_EVENT, type: "ANNOUNCEMENT" });
    expect(fetchSpy).not.toHaveBeenCalled();

    await setEventToggles(fixture.adminActor, {
      kind: "SLACK",
      eventToggles: {
        taskAssigned: true,
        mention: true,
        statusChange: true,
        overdueReminder: true,
        gateOverride: true,
        announcements: true,
        dailyBrief: false,
        weeklyBrief: false,
      },
    });

    await deliverToOrgWebhooks(fixture.orgId, { ...ASSIGNED_EVENT, type: "ANNOUNCEMENT" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(SLACK_URL);
  });

  it("escapes a title somebody typed into an announcement, in both payload shapes", async () => {
    const nasty = {
      ...ASSIGNED_EVENT,
      type: "ANNOUNCEMENT" as const,
      title: "Notice <https://evil.example|Reset your password>",
      body: "See <https://evil.example|this> and [Reset your password](https://evil.example)",
    };

    // The mrkdwn fields and the fallback text are escaped; Slack's plain_text header deliberately
    // is not, because Slack never parses that field (docs/CONVENTIONS.md, "Chat delivery").
    const slack = JSON.stringify(buildPayload("SLACK", nasty, "Announcement"));
    expect(slack).toContain("&lt;https://evil.example");
    const blocks = (buildPayload("SLACK", nasty, "Announcement") as {
      blocks: { type: string; text: { type: string; text: string } }[];
    }).blocks;
    for (const block of blocks) {
      if (block.text?.type === "mrkdwn") expect(block.text.text).not.toContain("<https://");
    }

    const teams = buildPayload("TEAMS", nasty, "Announcement") as {
      attachments: { content: { body: { text: string }[] } }[];
    };
    // A markdown link in a Teams card becomes a real, clickable link unless the brackets are
    // escaped — so a title somebody typed can never point the company's channel at their website.
    expect(teams.attachments[0].content.body[1].text).toContain("\\[Reset your password\\]");
  });

  it("sends both reminder kinds through the one overdue toggle", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);

    await deliverToOrgWebhooks(fixture.orgId, { ...ASSIGNED_EVENT, type: "DEADLINE_APPROACHING" });
    await deliverToOrgWebhooks(fixture.orgId, { ...ASSIGNED_EVENT, type: "OVERDUE" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("posts to every switched-on channel the company has", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);
    await connect("TEAMS", TEAMS_URL);

    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map((call) => call[0]).sort()).toEqual([SLACK_URL, TEAMS_URL].sort());
  });
});

describe("the fan-out, from notify() outwards", () => {
  it("posts ONCE per company however many people were notified", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);

    // Two recipients, one company, one chat message: the channel is the company's, not a person's.
    await notify(
      fixture.adminActor,
      [fixture.pmActor.userId, fixture.engineerActor.userId],
      "ASSIGNED",
      {
        title: ASSIGNED_EVENT.title,
        body: ASSIGNED_EVENT.body,
        linkUrl: ASSIGNED_EVENT.linkUrl,
      },
    );

    expect(await prisma.notification.count()).toBe(2);
    // notify() does not await the chat copy on purpose, so wait for it rather than assuming.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("survives an eventToggles value that is not the shape we expect", async () => {
    const fetchSpy = mockFetchOk();
    // A row from a future version, a bad hand edit, a half-finished migration — whatever the
    // reason, a notification must not fail because a chat setting cannot be read.
    await prisma.orgIntegration.create({
      data: {
        orgId: fixture.orgId,
        kind: "SLACK",
        webhookUrl: SLACK_URL,
        enabled: true,
        eventToggles: { somethingElse: "not a boolean" },
      },
    });

    await expect(deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();

    // And the same through notify(), which must still write its rows.
    await expect(
      notify(fixture.adminActor, [fixture.pmActor.userId], "ASSIGNED", {
        title: ASSIGNED_EVENT.title,
        body: ASSIGNED_EVENT.body,
        linkUrl: ASSIGNED_EVENT.linkUrl,
      }),
    ).resolves.toBeUndefined();
    expect(await prisma.notification.count()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the sweep's chat step is bounded", () => {
  const remindersFor = (orgId: string, count: number): SweepWebhookEvent[] =>
    Array.from({ length: count }, (_, index) => ({
      orgId,
      type: "OVERDUE" as const,
      title: "A task is overdue",
      body: `Task ${index} was due yesterday.`,
      linkUrl: `/discipline-tasks/task-${index}`,
    }));

  it("sends at most twenty reminders to one company in a single run", async () => {
    const fetchSpy = mockFetchOk();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    await connect("SLACK", SLACK_URL);

    await deliverSweepReminders(remindersFor(fixture.orgId, 25));

    expect(fetchSpy).toHaveBeenCalledTimes(MAX_CHAT_REMINDERS_PER_ORG);
    // The default budget stays short enough that an hourly job cannot be held up by chat.
    expect(CHAT_DELIVERY_BUDGET_MS).toBeLessThanOrEqual(60_000);
    expect(info).toHaveBeenCalledWith(
      "Chat reminders held back this sweep",
      expect.objectContaining({ orgId: fixture.orgId, sent: 20, heldBack: 5 }),
    );
  });

  it("stops when the time budget runs out, having always sent at least one", async () => {
    const fetchSpy = mockFetchOk();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    await connect("SLACK", SLACK_URL);

    // A budget of zero is the worst case a slow chat tool can produce: one message goes, the rest
    // are held back and said so in the log. The notification rows are already written either way.
    await deliverSweepReminders(remindersFor(fixture.orgId, 10), 0);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "Chat reminders held back this sweep",
      expect.objectContaining({
        sent: 1,
        heldBack: 9,
        reason: "the time budget for chat ran out",
      }),
    );
  });

  it("does not start a second company once the budget is gone", async () => {
    const fetchSpy = mockFetchOk();
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    await connect("SLACK", SLACK_URL);

    const other = await makeOrg("Another company entirely");
    await deliverSweepReminders(
      [...remindersFor(fixture.orgId, 2), ...remindersFor(other.id, 2)],
      0,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(SLACK_URL);
  });
});

describe("the SSRF guard at delivery time", () => {
  it("refuses to call an address that is not on the allowlist, however it got saved", async () => {
    const fetchSpy = mockFetchOk();
    // Straight into the database, past every validation the app has.
    await prisma.orgIntegration.create({
      data: {
        orgId: fixture.orgId,
        kind: "SLACK",
        webhookUrl: "http://169.254.169.254/latest/meta-data/",
        enabled: true,
        eventToggles: {
          taskAssigned: true,
          mention: true,
          statusChange: true,
          overdueReminder: true,
          gateOverride: true,
        },
      },
    });

    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("when the chat tool pushes back", () => {
  it("retries a 429 exactly once, at the pace the header asks for", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const started = Date.now();
    const outcome = await postToWebhook("SLACK", SLACK_URL, { text: "hello" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 15_000);

  it("gives up after the one retry, without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }),
    );

    const outcome = await postToWebhook("SLACK", SLACK_URL, { text: "hello" });
    expect(outcome).toMatchObject({ ok: false, status: 429 });
  }, 15_000);

  it("never waits longer than ten seconds, whatever the header says", () => {
    expect(retryAfterMs("2")).toBe(2_000);
    expect(retryAfterMs("600")).toBe(10_000);
    expect(retryAfterMs(null)).toBe(1_000);
    expect(retryAfterMs("not a number")).toBe(1_000);
  });

  it("logs the failure with the address REDACTED — kind and company only", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("channel_not_found", { status: 404 }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await connect("SLACK", SLACK_URL);
    await deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).not.toContain("Sup3rSecretT0kenValue");
    expect(logged).not.toContain("hooks.slack.com");
    expect(warn.mock.calls[0][1]).toMatchObject({ kind: "SLACK", orgId: fixture.orgId, status: 404 });
  });

  it("survives a chat tool that never answers", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hang up"));
    await connect("SLACK", SLACK_URL);

    await expect(deliverToOrgWebhooks(fixture.orgId, ASSIGNED_EVENT)).resolves.toBeUndefined();
  });
});

describe("the two payload shapes", () => {
  it("builds Slack blocks with a fallback line", () => {
    process.env.APP_BASE_URL = "https://tielora.example";
    const payload = buildPayload("SLACK", ASSIGNED_EVENT, "Task assigned") as {
      text: string;
      blocks: unknown[];
    };

    expect(payload.text).toContain("New task assigned to you");
    expect(payload.blocks.length).toBeGreaterThan(2);
    expect(JSON.stringify(payload)).toContain("https://tielora.example/discipline-tasks/abc123");
  });

  it("builds the Teams Adaptive Card envelope, version 1.4", () => {
    process.env.APP_BASE_URL = "https://tielora.example";
    const payload = buildPayload("TEAMS", ASSIGNED_EVENT, "Task assigned") as {
      type: string;
      attachments: { contentType: string; content: { version: string; actions?: unknown[] } }[];
    };

    expect(payload.type).toBe("message");
    expect(payload.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(payload.attachments[0].content.version).toBe("1.4");
    expect(payload.attachments[0].content.actions).toHaveLength(1);
  });

  it("still sends, with the path written out, when APP_BASE_URL is not set", () => {
    const teams = buildPayload("TEAMS", ASSIGNED_EVENT, "Task assigned") as {
      attachments: { content: { actions?: unknown[] } }[];
    };
    expect(teams.attachments[0].content.actions).toBeUndefined();
    expect(JSON.stringify(teams)).toContain("/discipline-tasks/abc123");

    const slack = buildPayload("SLACK", ASSIGNED_EVENT, "Task assigned");
    expect(JSON.stringify(slack)).toContain("/discipline-tasks/abc123");
  });

  it("never lets typed text become a link in a Slack message", () => {
    const nasty: WebhookEvent = {
      type: "ASSIGNED",
      title: "<https://evil.example|Reset your Tielora password>",
      body: "Click <https://evil.example|here> now &amp; sign in.",
      linkUrl: "/tasks/abc123",
    };
    const payload = buildPayload("SLACK", nasty, "Task assigned") as {
      text: string;
      blocks: { text?: { type: string; text: string } }[];
    };

    // Slack makes a link out of <url|label>, but only in a mrkdwn field. The fallback line Slack
    // shows in its own notification list is one of those, so it is escaped...
    expect(payload.text).not.toContain("<https://evil.example|");
    expect(payload.text).toContain("&lt;https://evil.example|");

    // ...as is every mrkdwn block. The header is a plain_text field, which Slack never parses, so
    // it is deliberately left alone — escaping it would show people "&lt;" instead of "<".
    const mrkdwn = payload.blocks
      .filter((block) => block.text?.type === "mrkdwn")
      .map((block) => block.text?.text ?? "");
    expect(mrkdwn.length).toBeGreaterThan(0);
    expect(JSON.stringify(mrkdwn)).not.toContain("<https://evil.example|");
  });

  it("never lets typed text become a link in a Teams card", () => {
    const nasty: WebhookEvent = {
      type: "ASSIGNED",
      title: "[Reset your Tielora password](https://evil.example)",
      body: "Run `rm -rf /` and see [this](https://evil.example).",
      linkUrl: "/tasks/abc123",
    };
    const payload = buildPayload("TEAMS", nasty, "Task assigned") as {
      attachments: { content: { body: { text: string }[] } }[];
    };
    const blocks = payload.attachments[0].content.body;

    // An Adaptive Card TextBlock renders markdown, so [label](url) would arrive clickable. The
    // brackets and backticks are escaped, which leaves them visible as themselves.
    expect(blocks[0].text).toBe("\\[Reset your Tielora password\\](https://evil.example)");
    expect(blocks[1].text).toContain("\\`rm -rf /\\`");
    expect(blocks[1].text).not.toContain("[this](");
    // Ordinary punctuation is left alone — titles are full of it.
    const ordinary = buildPayload("TEAMS", ASSIGNED_EVENT, "Task assigned") as {
      attachments: { content: { body: { text: string }[] } }[];
    };
    expect(ordinary.attachments[0].content.body[0].text).toBe("New task assigned to you");
  });

  it("refuses to send a card past the 28 KB cap rather than being rejected", async () => {
    const fetchSpy = mockFetchOk();
    const outcome = await postToWebhook("TEAMS", TEAMS_URL, { filler: "x".repeat(30_000) });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("too large");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the test message", () => {
  it("posts one card and reports plainly that it arrived", async () => {
    const fetchSpy = mockFetchOk();
    await connect("SLACK", SLACK_URL);

    const result = await sendIntegrationTest(fixture.adminActor, { kind: "SLACK" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(true);
    expect(result.message).toContain("Slack");
    expect(JSON.stringify(result)).not.toContain("Sup3rSecretT0kenValue");
  });

  it("says why it did not arrive, without leaking the address or the provider's words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("channel_not_found", { status: 404 }));
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await connect("SLACK", SLACK_URL);

    const result = await sendIntegrationTest(fixture.adminActor, { kind: "SLACK" });

    expect(result.delivered).toBe(false);
    expect(result.message).toContain("no longer exists");
    expect(result.message).not.toContain("channel_not_found");
    expect(result.message).not.toContain("hooks.slack.com");

    const audit = await prisma.activityLog.findFirst({
      where: { action: "INTEGRATION_TEST_SENT" },
    });
    expect(audit?.metadata).toMatchObject({ delivered: false });
  });

  it("needs an address before it will send anything", async () => {
    await expect(
      sendIntegrationTest(fixture.adminActor, { kind: "TEAMS" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

/* ------------------------------------------------------------------ */
/* Alert and brief emails                                              */
/* ------------------------------------------------------------------ */

const ALERT = {
  title: "New task assigned to you",
  body: "You were given “Flare tip inspection”.",
  linkUrl: "/discipline-tasks/abc123",
};

const DAY = 24 * 60 * 60 * 1000;

/** notify() from the administrator's seat, as a service would call it. */
function notifyFromAdmin(
  userIds: string[],
  type: Parameters<typeof notify>[2],
  payload = ALERT,
  options?: Parameters<typeof notify>[4],
) {
  return notify(
    { userId: fixture.adminActor.userId, orgId: fixture.orgId },
    userIds,
    type,
    payload,
    options,
  );
}

describe("alert emails, from notify() outwards", () => {
  let engineerEmail: string;

  beforeEach(async () => {
    configureEmail();
    engineerEmail = await optIn(fixture.engineerActor.userId);
  });

  afterEach(() => goDormant());

  it("emails only the seven notification types that have a chat toggle", async () => {
    const spy = mockEmailFetchOk();
    const emailed = [
      "ASSIGNED",
      "MENTIONED",
      "STATUS_CHANGED",
      "DEADLINE_APPROACHING",
      "OVERDUE",
      "OVERRIDE_APPLIED",
      "ANNOUNCEMENT",
    ] as const;
    for (const type of [...emailed, "DOCUMENT_UPLOADED", "COMMENT_ADDED"] as const) {
      await notifyFromAdmin([fixture.engineerActor.userId], type);
    }
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(7));
    await settle();
    expect(sentEmails(spy)).toHaveLength(7);
    for (const type of emailed) expect(toggleForType(type)).not.toBeNull();
    // The in-app rows are all there — nine of them — whatever email did.
    expect(await prisma.notification.count({ where: { userId: fixture.engineerActor.userId } })).toBe(9);
  });

  it("sends nothing for an upload or an ordinary comment", async () => {
    const spy = mockEmailFetchOk();
    await notifyFromAdmin([fixture.engineerActor.userId], "DOCUMENT_UPLOADED");
    await notifyFromAdmin([fixture.engineerActor.userId], "COMMENT_ADDED");
    await settle();
    expect(sentEmails(spy)).toHaveLength(0);
  });

  it("sends nothing with alerts off, whatever the company's chat toggles say", async () => {
    const spy = mockEmailFetchOk();
    await connect("SLACK", SLACK_URL); // every notification copy switched on
    await optIn(fixture.engineerActor.userId, { alerts: false });

    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await vi.waitFor(() => expect(spy.mock.calls.some((call) => String(call[0]) === SLACK_URL)).toBe(true));
    await settle();
    expect(sentEmails(spy)).toHaveLength(0);
  });

  it("still emails with alerts on when the company has no chat at all (the toggles have no say)", async () => {
    const spy = mockEmailFetchOk();
    expect(await prisma.orgIntegration.count()).toBe(0);
    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));
    expect(sentEmails(spy)[0].to).toEqual([engineerEmail]);
  });

  it("still emails when the company's chat has that event switched OFF", async () => {
    const spy = mockEmailFetchOk();
    await connect("SLACK", SLACK_URL);
    await setEventToggles(fixture.adminActor, {
      kind: "SLACK",
      eventToggles: {
        taskAssigned: false,
        mention: false,
        statusChange: false,
        overdueReminder: false,
        gateOverride: false,
        announcements: false,
        dailyBrief: false,
        weeklyBrief: false,
      },
    });
    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));
    await settle();
    expect(spy.mock.calls.some((call) => String(call[0]) === SLACK_URL)).toBe(false);
  });

  it("sends nothing to an address that has not been confirmed", async () => {
    const spy = mockEmailFetchOk();
    await optIn(fixture.engineerActor.userId, { verified: false });
    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await settle();
    expect(sentEmails(spy)).toHaveLength(0);
  });

  it("sends exactly one email per notification row, to that row's own person", async () => {
    const spy = mockEmailFetchOk();
    const pmEmail = await optIn(fixture.pmActor.userId);
    const engineer = fixture.engineerActor.userId;

    await notifyFromAdmin([engineer, engineer, fixture.pmActor.userId, engineer], "ASSIGNED");
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(2));
    await settle();

    const sent = sentEmails(spy);
    expect(sent).toHaveLength(2);
    expect(sent.map((email) => email.to[0]).sort()).toEqual([engineerEmail, pmEmail].sort());
    expect(await prisma.notification.count()).toBe(2);
  });

  it("builds the email from the row and nothing wider", async () => {
    const spy = mockEmailFetchOk();
    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));

    const [email] = sentEmails(spy);
    expect(email.subject).toBe(ALERT.title);
    expect(email.text.split("\n").slice(0, 6)).toEqual([
      "Tielora — Alert",
      "",
      ALERT.body,
      "",
      "Open it in Tielora:",
      `${EMAIL_BASE}${ALERT.linkUrl}`,
    ]);
    expect(email.text).toContain(`Change all your email settings: ${EMAIL_BASE}/account`);
    expect(email.text).toContain(`Stop emails like this one: ${EMAIL_BASE}/unsubscribe?t=`);
  });

  it("lets notify() finish even when the mail provider hangs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));
    await expect(notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED")).resolves.toBeUndefined();
    expect(await prisma.notification.count()).toBe(1);
  });

  it("lets notify() finish, and logs without the address, when the mail call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`boom ${engineerEmail}`));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await expect(notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED")).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(JSON.stringify(warn.mock.calls)).not.toContain(engineerEmail);
    expect(JSON.stringify(warn.mock.calls)).toContain(fixture.engineerActor.userId);
  });

  it("retries a 429 exactly once, then drops it", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("slow down", { status: 429, headers: { "retry-after": "1" } }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 3_000 });
    expect(sentEmails(spy)).toHaveLength(2);
    expect(warn.mock.calls[0][1]).toMatchObject({ purpose: "ALERT", status: 429 });
  });

  it("sends nothing and changes nothing while email is not set up", async () => {
    goDormant();
    const spy = mockEmailFetchOk();
    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(1);
  });

  it("sends no email for a fan-out written with { chatCopy: false }", async () => {
    const spy = mockEmailFetchOk();
    await notifyFromAdmin([fixture.engineerActor.userId], "ANNOUNCEMENT", ALERT, { chatCopy: false });
    await settle();
    expect(sentEmails(spy)).toHaveLength(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("never emails the workspace-deletion messages to administrators", async () => {
    const secondAdmin = await makeUser({ name: "Salma Admin", role: "ADMIN", orgId: fixture.orgId });
    await optIn(secondAdmin.id);
    const spy = mockEmailFetchOk();

    await requestWorkspaceDeletion(fixture.adminActor, { confirmName: "Tielora Test Company" });
    await settle();

    expect(await prisma.notification.count({ where: { userId: secondAdmin.id } })).toBe(1);
    expect(sentEmails(spy)).toHaveLength(0);
  });

  it("never emails a contractor-access-expiry warning", async () => {
    const contractor = await makeUser({ name: "Yusuf Contractor", role: "EXTERNAL", orgId: fixture.orgId });
    await prisma.user.update({
      where: { id: contractor.id },
      data: { accessExpiresAt: new Date(Date.now() + 3 * DAY) },
    });
    await optIn(fixture.adminActor.userId);
    const spy = mockEmailFetchOk();

    await runSweepOnce(new Date());
    await settle();

    expect(
      await prisma.notification.count({ where: { userId: fixture.adminActor.userId, type: "DEADLINE_APPROACHING" } }),
    ).toBe(1);
    expect(sentEmails(spy)).toHaveLength(0);
  });

  it("removes typed web addresses from the email copy only, leaving Arabic text intact", async () => {
    const spy = mockEmailFetchOk();
    const arabic = "فحص رأس الشعلة";
    await notifyFromAdmin([fixture.engineerActor.userId], "ANNOUNCEMENT", {
      title: `${arabic} https://evil.example/login\r\nBcc: x\u0007`,
      body: `${arabic} https://evil.example/x — see www.evil.example.`,
      linkUrl: "/messages?tab=org",
    });
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));

    const [email] = sentEmails(spy);
    expect(email.subject).toBe(`${arabic} [link removed] Bcc: x`);
    expect(email.text).toContain(`${arabic} [link removed] — see [link removed].`);
    expect(email.text).not.toContain("evil.example");

    // The in-app row keeps exactly what was written.
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: fixture.engineerActor.userId } });
    expect(row.title).toContain("https://evil.example/login");
    expect(row.body).toContain("www.evil.example");
  });

  it("carries the one-click unsubscribe headers on an alert, naming that person and kind", async () => {
    const spy = mockEmailFetchOk();
    await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED");
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));

    const headers = sentEmails(spy)[0].headers ?? {};
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const match = /^<https:\/\/tielora\.example\/api\/email\/unsubscribe\?t=([^>]+)>$/.exec(
      headers["List-Unsubscribe"] ?? "",
    );
    expect(match).not.toBeNull();
    expect(verifyUnsubscribeToken(decodeURIComponent(match?.[1] ?? ""))).toEqual({
      personId: fixture.engineerActor.userId,
      kind: "ALERTS",
    });
  });

  it("never puts unsubscribe headers or lines on an invitation, a reset or a verification", async () => {
    const spy = mockEmailFetchOk();
    const person = { id: fixture.engineerActor.userId, name: "John Carter", email: engineerEmail };
    await sendInviteEmail({ ...person, inviterName: "Admin", organizationName: "Co" }, `${EMAIL_BASE}/set-password?token=x`);
    await sendPasswordResetEmail(person, `${EMAIL_BASE}/reset-password?token=x`);
    await sendVerificationEmail(person, `${EMAIL_BASE}/verify-email?token=x`);

    const sent = sentEmails(spy);
    expect(sent).toHaveLength(3);
    for (const email of sent) {
      expect(email.headers).toBeUndefined();
      expect(email.text).not.toMatch(/unsubscribe|Stop emails like this one/i);
    }
  });

  it("holds back the twenty-first alert to one person inside an hour", async () => {
    const spy = mockEmailFetchOk();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    for (let index = 0; index <= ALERT_EMAILS_PER_HOUR; index += 1) {
      await notifyFromAdmin([fixture.engineerActor.userId], "ASSIGNED", {
        ...ALERT,
        linkUrl: `/discipline-tasks/t${index}`,
      });
    }
    await vi.waitFor(() =>
      expect(info.mock.calls.some((call) => call[0] === "Alert email held back")).toBe(true),
    );
    await settle();

    expect(sentEmails(spy)).toHaveLength(ALERT_EMAILS_PER_HOUR);
    expect(await prisma.notification.count()).toBe(ALERT_EMAILS_PER_HOUR + 1);
    expect(JSON.stringify(info.mock.calls)).not.toContain(engineerEmail);
  });
});

describe("the sweep's reminder emails", () => {
  beforeEach(() => configureEmail());
  afterEach(() => goDormant());

  async function taskDue(deadline: Date) {
    return createMainTask(fixture.adminActor, {
      projectId: fixture.projectId,
      title: "Vendor drawing review",
      description: "A reminder test.",
      priority: "MEDIUM",
      deadline,
      ownerId: fixture.pmActor.userId,
      disciplineTasks: [
        {
          disciplineId: fixture.disciplineId,
          title: "Mechanical check",
          assigneeId: fixture.engineerActor.userId,
          deadline,
          isMandatory: true,
          requiredDocuments: [],
        },
      ],
    });
  }

  it("emails the reminder to the person it was written for, and only if they asked", async () => {
    const deadline = inThirtyDays();
    await taskDue(deadline);
    const engineerEmail = await optIn(fixture.engineerActor.userId);
    await optIn(fixture.pmActor.userId, { alerts: false });
    const spy = mockEmailFetchOk();

    await runSweepOnce(new Date(deadline.getTime() + DAY));

    // The assignee and the owner both got an OVERDUE row; only the one who asked got an email.
    expect(await prisma.notification.count({ where: { type: "OVERDUE" } })).toBe(2);
    const sent = sentEmails(spy);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([engineerEmail]);
    expect(sent[0].subject).toBe("A task is overdue");
    expect(sent[0].text).toContain("Mechanical check");
  });

  it("stops at its own time budget, having always sent at least one", async () => {
    await optIn(fixture.engineerActor.userId);
    const spy = mockEmailFetchOk();
    const reminder = (n: number) => ({
      userId: fixture.engineerActor.userId,
      type: "OVERDUE" as const,
      title: "A task is overdue",
      body: `"Task ${n}" was due on 1 Sep 2026.`,
      linkUrl: `/discipline-tasks/r${n}`,
    });

    const run = await emailSweepReminders([reminder(1), reminder(2), reminder(3)], 0);

    expect(run).toEqual({ sent: 1, heldBack: 2 });
    expect(sentEmails(spy)).toHaveLength(1);
  });
});

describe("the daily brief email", () => {
  /** 06:00 UTC today — after the 05:00 line. */
  const morning = (): Date => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6));
  };
  const startOfToday = (): Date => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  };

  async function workDueToday(assigneeIds: string[]) {
    await createMainTask(fixture.adminActor, {
      projectId: fixture.projectId,
      title: "Flare tip replacement",
      description: "Daily brief test.",
      priority: "HIGH",
      deadline: startOfToday(),
      disciplineTasks: assigneeIds.map((assigneeId, index) => ({
        disciplineId: fixture.disciplineId,
        title: `Due today ${index + 1}`,
        assigneeId,
        deadline: startOfToday(),
        isMandatory: true,
        requiredDocuments: [],
      })),
    });
  }

  const stampOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dailyBriefEmailedAt: true } }))
      .dailyBriefEmailedAt;

  beforeEach(() => configureEmail());
  afterEach(() => goDormant());

  it("sends each person their own day once, and stamps it after the attempt", async () => {
    await workDueToday([fixture.engineerActor.userId]);
    const engineerEmail = await optIn(fixture.engineerActor.userId, { alerts: false, daily: true });
    const spy = mockEmailFetchOk();

    const first = await sendDailyBriefEmails(morning());
    expect(first).toEqual({ people: 1, sent: 1 });
    const [email] = sentEmails(spy);
    expect(email.to).toEqual([engineerEmail]);
    expect(email.subject).toMatch(/^Your day — \d{1,2} [A-Z][a-z]{2} \d{4} \(1 due today\)$/);
    expect(email.text).toContain("Tielora — Your day");
    expect(email.text).toContain("DUE TODAY (1)");
    expect(email.text).toContain("- Due today 1 (");
    expect(email.text).toContain(`Open your day in Tielora:\n${EMAIL_BASE}/my-tasks/brief`);
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = /\?t=([^>]+)>/.exec(email.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? "";
    expect(verifyUnsubscribeToken(decodeURIComponent(token))?.kind).toBe("DAILY");
    expect(await stampOf(fixture.engineerActor.userId)).toEqual(morning());

    // The other twenty-three sweeps of the day do nothing for them.
    const again = await sendDailyBriefEmails(new Date(morning().getTime() + 60 * 60 * 1000));
    expect(again.people).toBe(0);
    expect(sentEmails(spy)).toHaveLength(1);

    // Tomorrow's line earns tomorrow's brief.
    const tomorrow = await sendDailyBriefEmails(new Date(morning().getTime() + DAY));
    expect(tomorrow.sent).toBe(1);
  });

  it("sends nothing on an empty day, but still stamps it", async () => {
    await optIn(fixture.outsiderActor.userId, { daily: true });
    const spy = mockEmailFetchOk();

    const run = await sendDailyBriefEmails(morning());

    expect(run).toEqual({ people: 1, sent: 0 });
    expect(sentEmails(spy)).toHaveLength(0);
    expect(await stampOf(fixture.outsiderActor.userId)).toEqual(morning());
  });

  it("resumes with the people it had not reached when the budget cut it short", async () => {
    await workDueToday([fixture.engineerActor.userId, fixture.pmActor.userId]);
    await optIn(fixture.engineerActor.userId, { alerts: false, daily: true });
    await optIn(fixture.pmActor.userId, { alerts: false, daily: true });
    const spy = mockEmailFetchOk();

    const cut = await sendDailyBriefEmails(morning(), 0);
    expect(cut.people).toBe(1);
    const firstTo = sentEmails(spy)[0].to[0];

    const rest = await sendDailyBriefEmails(new Date(morning().getTime() + 60 * 60 * 1000), 0);
    expect(rest.people).toBe(1);
    const sent = sentEmails(spy);
    expect(sent).toHaveLength(2);
    expect(sent[1].to[0]).not.toBe(firstTo);
  });

  it("stamps today when somebody switches it on, so the first one comes next morning", async () => {
    await workDueToday([fixture.engineerActor.userId]);
    await optIn(fixture.engineerActor.userId, { alerts: false, daily: false });
    const spy = mockEmailFetchOk();

    const before = Date.now();
    await setEmailPreferences(fixture.engineerActor, { emailDailyBrief: true });
    const stamp = (await stampOf(fixture.engineerActor.userId)) as Date;
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before);

    expect((await sendDailyBriefEmails(new Date(stamp.getTime() + 1))).sent).toBe(0);
    const nextMorning = new Date(
      Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth(), stamp.getUTCDate() + 1, 6),
    );
    expect((await sendDailyBriefEmails(nextMorning)).people).toBe(1);
    expect(sentEmails(spy)).toHaveLength(1);
  });

  it("runs for a company with no chat channel at all, from the real sweep", async () => {
    await workDueToday([fixture.engineerActor.userId]);
    await optIn(fixture.engineerActor.userId, { alerts: false, daily: true });
    expect(await prisma.orgIntegration.count()).toBe(0);
    const spy = mockEmailFetchOk();

    await runSweepOnce(morning());

    expect(sentEmails(spy).filter((email) => email.subject.startsWith("Your day"))).toHaveLength(1);
  });

  it("does nothing and stamps nothing while email is not set up", async () => {
    await workDueToday([fixture.engineerActor.userId]);
    await optIn(fixture.engineerActor.userId, { daily: true });
    goDormant();
    const spy = mockEmailFetchOk();

    expect(await sendDailyBriefEmails(morning())).toEqual({ people: 0, sent: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(await stampOf(fixture.engineerActor.userId)).toBeNull();
  });

  it("never sends a contractor a brief, whatever their row says", async () => {
    const contractor = await makeUser({ name: "Yusuf Contractor", role: "EXTERNAL", orgId: fixture.orgId });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: contractor.id, projectRole: "EXTERNAL" },
    });
    await workDueToday([contractor.id]);
    await optIn(contractor.id, { alerts: false, daily: true, weekly: true });
    const spy = mockEmailFetchOk();

    expect(await sendDailyBriefEmails(morning())).toEqual({ people: 0, sent: 0 });
    expect(sentEmails(spy)).toHaveLength(0);
    expect(await stampOf(contractor.id)).toBeNull();
  });

  it("writes no notification row and no audit row", async () => {
    await workDueToday([fixture.engineerActor.userId]);
    await optIn(fixture.engineerActor.userId, { alerts: false, daily: true });
    mockEmailFetchOk();
    const notifications = await prisma.notification.count();
    const audit = await prisma.activityLog.count();

    expect((await sendDailyBriefEmails(morning())).sent).toBe(1);

    expect(await prisma.notification.count()).toBe(notifications);
    expect(await prisma.activityLog.count()).toBe(audit);
  });

  it("builds each brief for that person's own actor", async () => {
    await workDueToday([fixture.engineerActor.userId]);
    await optIn(fixture.pmActor.userId, { alerts: false, daily: true });
    const spy = mockEmailFetchOk();

    // The project manager owns nothing due today, so their day is empty and nothing goes.
    expect((await sendDailyBriefEmails(morning())).sent).toBe(0);
    expect(sentEmails(spy)).toHaveLength(0);
    expect((await actorForUser(fixture.pmActor.userId)).userId).toBe(fixture.pmActor.userId);
  });
});

/* ------------------------------------------------------------------ */
/* The weekly brief                                                    */
/* ------------------------------------------------------------------ */

/** Monday 00:00 UTC of the current week, plus the given hours (and optionally whole weeks). */
const monday = (hours: number, weeks = 0): Date => {
  const now = new Date();
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday + 7 * weeks) +
      hours * 60 * 60 * 1000,
  );
};
const WEEKLY_SLACK_2 = "https://hooks.slack.com/services/T22222222/B22222222/AnotherSecretTokenVal";

/** Posts to a given channel address, out of everything a spy received. */
const postsTo = (spy: { mock: { calls: unknown[][] } }, url: string) =>
  spy.mock.calls.filter((call) => String(call[0]) === url);

async function connectWeekly(
  kind: "SLACK" | "TEAMS",
  url: string,
  options: { weekly?: boolean; daily?: boolean; actor?: Fixture["adminActor"] } = {},
) {
  const actor = options.actor ?? fixture.adminActor;
  await saveIntegration(actor, { kind, webhookUrl: url });
  await setIntegrationEnabled(actor, { kind, enabled: true });
  await setEventToggles(actor, {
    kind,
    eventToggles: {
      ...DEFAULT_EVENT_TOGGLES,
      weeklyBrief: options.weekly ?? true,
      dailyBrief: options.daily ?? false,
    },
  });
}

describe("the weekly brief toggle", () => {
  it("defaults to off, and an old six-key block still parses", () => {
    const old = {
      taskAssigned: true,
      mention: true,
      statusChange: true,
      overdueReminder: true,
      gateOverride: true,
      dailyBrief: true,
    };
    const parsed = IntegrationEventToggles.parse(old);
    expect(parsed.weeklyBrief).toBe(false);
    expect(parsed.announcements).toBe(false);
    expect(parsed.dailyBrief).toBe(true);
    expect(DEFAULT_EVENT_TOGGLES.weeklyBrief).toBe(false);
    expect(toggleForType("OVERDUE")).toBe("overdueReminder");
  });

  it("is off for a freshly connected channel, and the admin screen is told so", async () => {
    await saveIntegration(fixture.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
    const slack = (await listIntegrationsForAdmin(fixture.adminActor)).find((item) => item.kind === "SLACK");
    expect(slack?.eventToggles.weeklyBrief).toBe(false);
  });
});

describe("the weekly brief, in chat", () => {
  it("has a send line of Monday 05:00 UTC, open until 05:00 UTC Tuesday", () => {
    expect(weeklyBoundary(monday(4.99))).toBeNull();
    expect(weeklyBoundary(monday(5))).toEqual(monday(5));
    expect(weeklyBoundary(monday(23))).toEqual(monday(5));
    expect(weeklyBoundary(monday(28.99))).toEqual(monday(5));
    expect(weeklyBoundary(monday(29))).toBeNull();
    expect(weeklyBoundary(monday(24 * 6 + 12))).toBeNull(); // Sunday
  });

  it("goes once per channel per week, and again the next Monday", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    const spy = mockFetchOk();

    expect((await postWeeklyBriefs(monday(6))).channels).toBe(1);
    expect(postsTo(spy, SLACK_URL)).toHaveLength(1);

    await postWeeklyBriefs(monday(7));
    await postWeeklyBriefs(monday(28));
    expect(postsTo(spy, SLACK_URL)).toHaveLength(1);

    await postWeeklyBriefs(monday(6, 1));
    expect(postsTo(spy, SLACK_URL)).toHaveLength(2);
  });

  it("makes only the channel enabled later on Monday due", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    const spy = mockFetchOk();
    await postWeeklyBriefs(monday(6));

    await connectWeekly("TEAMS", TEAMS_URL);
    await postWeeklyBriefs(monday(9));

    expect(postsTo(spy, SLACK_URL)).toHaveLength(1);
    expect(postsTo(spy, TEAMS_URL)).toHaveLength(1);
  });

  it("is not sent before Monday 05:00, is sent late on Monday, and is skipped after Tuesday 05:00", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    const spy = mockFetchOk();

    await postWeeklyBriefs(monday(4.9));
    expect(spy).not.toHaveBeenCalled();

    await postWeeklyBriefs(monday(23));
    expect(postsTo(spy, SLACK_URL)).toHaveLength(1);

    // A server that was down all Monday and came up on Tuesday morning still sends ...
    await prisma.orgIntegration.updateMany({ data: { weeklyBriefSentAt: null } });
    await postWeeklyBriefs(monday(28));
    expect(postsTo(spy, SLACK_URL)).toHaveLength(2);

    // ... but from 05:00 UTC Tuesday the week is skipped, and nothing is stamped.
    await prisma.orgIntegration.updateMany({ data: { weeklyBriefSentAt: null } });
    await postWeeklyBriefs(monday(29));
    await postWeeklyBriefs(monday(24 * 3 + 6));
    expect(postsTo(spy, SLACK_URL)).toHaveLength(2);
    expect((await prisma.orgIntegration.findFirstOrThrow()).weeklyBriefSentAt).toBeNull();
  });

  it("skips channels that are disabled or have the toggle off", async () => {
    await connectWeekly("SLACK", SLACK_URL, { weekly: true });
    await setIntegrationEnabled(fixture.adminActor, { kind: "SLACK", enabled: false });
    await connectWeekly("TEAMS", TEAMS_URL, { weekly: false, daily: true });
    const spy = mockFetchOk();

    const run = await postWeeklyBriefs(monday(6));

    expect(run).toEqual({ orgs: 0, channels: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("stamps a company with no active project and sends nothing", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    await prisma.project.update({ where: { id: fixture.projectId }, data: { status: "ARCHIVED" } });
    const spy = mockFetchOk();

    const run = await postWeeklyBriefs(monday(6));

    expect(run).toEqual({ orgs: 1, channels: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect((await prisma.orgIntegration.findFirstOrThrow()).weeklyBriefSentAt).toEqual(monday(6));
  });

  it("uses its own 30-second budget, longest-waiting company first", async () => {
    const other = await makeOrg("Second Company");
    const second = await makeProjectFixture(other.id);
    await connectWeekly("SLACK", SLACK_URL);
    await connectWeekly("SLACK", WEEKLY_SLACK_2, { actor: second.adminActor });
    // The second company has waited longest (never sent); the first was sent last week.
    await prisma.orgIntegration.updateMany({
      where: { orgId: fixture.orgId },
      data: { weeklyBriefSentAt: monday(6, -1) },
    });
    const spy = mockFetchOk();

    // A budget of zero still lets one company through, then holds the rest back.
    const cut = await postWeeklyBriefs(monday(6), 0);
    expect(cut.orgs).toBe(1);
    expect(postsTo(spy, WEEKLY_SLACK_2)).toHaveLength(1);
    expect(postsTo(spy, SLACK_URL)).toHaveLength(0);

    const rest = await postWeeklyBriefs(monday(7), 0);
    expect(rest.orgs).toBe(1);
    expect(postsTo(spy, SLACK_URL)).toHaveLength(1);
    expect(CHAT_DELIVERY_BUDGET_MS).toBe(30_000);
  });

  it("says what the brief promises: both kinds late, what is new this week, quiet projects listed", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    const now = monday(6);
    const threeDaysBefore = new Date(monday(0).getTime() - 3 * 24 * 60 * 60 * 1000);
    const task = await createMainTask(fixture.adminActor, {
      projectId: fixture.projectId,
      title: "Late piping",
      description: "Weekly brief test.",
      priority: "HIGH",
      deadline: inThirtyDays(),
      disciplineTasks: [
        {
          disciplineId: fixture.disciplineId,
          title: "Late spool",
          assigneeId: fixture.engineerActor.userId,
          deadline: inThirtyDays(),
          isMandatory: true,
          requiredDocuments: [{ name: "Weld map", isMandatory: true }],
        },
      ],
    });
    await prisma.mainTask.update({ where: { id: task.id }, data: { deadline: threeDaysBefore } });
    await prisma.disciplineTask.updateMany({
      where: { mainTaskId: task.id },
      data: { deadline: threeDaysBefore },
    });
    const spy = mockFetchOk();

    await postWeeklyBriefs(now);

    const body = JSON.parse(String((postsTo(spy, SLACK_URL)[0][1] as RequestInit).body));
    const text = JSON.stringify(body);
    expect(text).toContain("This week's brief — 1 active project");
    expect(text).toContain("1 main task and 1 discipline task late (2 new this week)");
    expect(text).toContain("1 document missing");
    expect(text).toContain("0% (no work yet a week ago)");
    expect(text).not.toContain(SLACK_URL);
  });

  it("stays under the 28 KB cap at twelve projects, with 'and N more' after them", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    const longName = "Enormous refinery turnaround programme with a very long name ".repeat(8);
    for (let index = 0; index < 14; index += 1) {
      await prisma.project.create({
        data: {
          orgId: fixture.orgId,
          name: longName,
          code: `BIG-${index}`,
          description: "x",
          createdById: fixture.adminActor.userId,
        },
      });
    }
    const spy = mockFetchOk();

    await postWeeklyBriefs(monday(6));

    const [, init] = postsTo(spy, SLACK_URL)[0];
    const raw = String((init as RequestInit).body);
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThan(28 * 1024);
    // 15 active projects in all: twelve lines, then the rest counted.
    expect(raw).toContain("This week's brief — 15 active projects");
    expect(raw).toContain("and 3 more active projects");
    expect(raw).not.toContain("…\\n•"); // no line was cut off mid-list
  });

  it("writes no audit row and no notification row", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    mockFetchOk();
    const audit = await prisma.activityLog.count();
    const notifications = await prisma.notification.count();

    expect((await postWeeklyBriefs(monday(6))).channels).toBe(1);

    expect(await prisma.activityLog.count()).toBe(audit);
    expect(await prisma.notification.count()).toBe(notifications);
  });

  it("runs as part of the real sweep, after the daily digest", async () => {
    await connectWeekly("SLACK", SLACK_URL);
    const spy = mockFetchOk();

    await runSweepOnce(monday(6));

    expect(postsTo(spy, SLACK_URL)).toHaveLength(1);
  });
});

describe("the weekly brief, by email", () => {
  const stampOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { weeklyBriefEmailedAt: true } }))
      .weeklyBriefEmailedAt;

  /** A second project that only the project manager belongs to. */
  async function otherProject() {
    return prisma.project.create({
      data: {
        orgId: fixture.orgId,
        name: "Hidden terminal build",
        code: "HIDDEN-9",
        description: "x",
        createdById: fixture.adminActor.userId,
        members: { create: [{ userId: fixture.pmActor.userId, projectRole: "PROJECT_MANAGER" }] },
      },
    });
  }

  beforeEach(() => configureEmail());
  afterEach(() => goDormant());

  it("goes only to people who opted in, are active and are not contractors", async () => {
    const engineerEmail = await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    await optIn(fixture.pmActor.userId, { alerts: false, weekly: false });
    const contractor = await makeUser({ name: "Yusuf Contractor", role: "EXTERNAL", orgId: fixture.orgId });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: contractor.id, projectRole: "EXTERNAL" },
    });
    await optIn(contractor.id, { alerts: false, weekly: true });
    const gone = await optIn(fixture.outsiderActor.userId, { alerts: false, weekly: true });
    await prisma.user.update({ where: { id: fixture.outsiderActor.userId }, data: { isActive: false } });
    const spy = mockEmailFetchOk();

    const run = await sendWeeklyBriefEmails(monday(6));

    expect(run).toEqual({ people: 1, sent: 1 });
    const [email] = sentEmails(spy);
    expect(email.to).toEqual([engineerEmail]);
    expect(email.to).not.toContain(gone);
    expect(email.subject).toBe("This week's brief — 1 active project");
    expect(email.text).toContain("Tielora — Your week");
    expect(email.text).toContain(`Open Tielora:\n${EMAIL_BASE}/dashboard`);
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = /\?t=([^>]+)>/.exec(email.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? "";
    expect(verifyUnsubscribeToken(decodeURIComponent(token))?.kind).toBe("WEEKLY");
    expect(await stampOf(fixture.engineerActor.userId)).toEqual(monday(6));
    expect(await stampOf(contractor.id)).toBeNull();
  });

  it("names only the projects that person may see", async () => {
    const hidden = await otherProject();
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    await optIn(fixture.pmActor.userId, { alerts: false, weekly: true });
    await optIn(fixture.adminActor.userId, { alerts: false, weekly: true });
    const spy = mockEmailFetchOk();
    const visible = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });

    await sendWeeklyBriefEmails(monday(6));

    const byName = (await prisma.user.findMany({ select: { id: true, email: true } })).reduce(
      (map, user) => map.set(user.email, user.id),
      new Map<string, string>(),
    );
    const textFor = (userId: string) =>
      sentEmails(spy).find((email) => byName.get(email.to[0]) === userId)?.text ?? "";

    // The engineer belongs to one project; the hidden one is not named, not even by count.
    expect(textFor(fixture.engineerActor.userId)).toContain(visible.code);
    expect(textFor(fixture.engineerActor.userId)).not.toContain(hidden.code);
    expect(textFor(fixture.engineerActor.userId)).not.toContain("Hidden terminal");
    expect(textFor(fixture.engineerActor.userId)).not.toContain("more active project");
    // The project manager belongs to both, and an administrator sees all of their own company's.
    expect(textFor(fixture.pmActor.userId)).toContain(hidden.code);
    expect(textFor(fixture.adminActor.userId)).toContain(hidden.code);
    expect(textFor(fixture.adminActor.userId)).toContain(visible.code);
  });

  it("sends nothing to a person who sees no project, but still stamps them", async () => {
    await optIn(fixture.outsiderActor.userId, { alerts: false, weekly: true });
    const spy = mockEmailFetchOk();

    const run = await sendWeeklyBriefEmails(monday(6));

    expect(run).toEqual({ people: 1, sent: 0 });
    expect(sentEmails(spy)).toHaveLength(0);
    expect(await stampOf(fixture.outsiderActor.userId)).toEqual(monday(6));
  });

  it("goes once a week, on the same send line and catch-up window as the chat card", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    const spy = mockEmailFetchOk();

    expect((await sendWeeklyBriefEmails(monday(4.5))).people).toBe(0);
    expect((await sendWeeklyBriefEmails(monday(6))).sent).toBe(1);
    expect((await sendWeeklyBriefEmails(monday(7))).people).toBe(0);
    expect((await sendWeeklyBriefEmails(monday(6, 1))).sent).toBe(1);
    expect(sentEmails(spy)).toHaveLength(2);

    // Skipped after 05:00 UTC Tuesday.
    await prisma.user.update({
      where: { id: fixture.engineerActor.userId },
      data: { weeklyBriefEmailedAt: null },
    });
    expect((await sendWeeklyBriefEmails(monday(29, 2))).people).toBe(0);
    expect((await sendWeeklyBriefEmails(monday(28, 2))).sent).toBe(1);
  });

  it("resumes with the people it had not reached when the budget cut it short", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    await optIn(fixture.pmActor.userId, { alerts: false, weekly: true });
    const spy = mockEmailFetchOk();

    expect((await sendWeeklyBriefEmails(monday(6), 0)).people).toBe(1);
    expect((await sendWeeklyBriefEmails(monday(7), 0)).people).toBe(1);

    const sent = sentEmails(spy);
    expect(sent).toHaveLength(2);
    expect(sent[0].to[0]).not.toBe(sent[1].to[0]);
  });

  it("stamps now when somebody switches it on, so the first one comes next Monday", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: false });
    const spy = mockEmailFetchOk();

    await setEmailPreferences(fixture.engineerActor, { emailWeeklyBrief: true });
    const stamp = (await stampOf(fixture.engineerActor.userId)) as Date;
    expect(stamp).not.toBeNull();

    // A sweep on Monday morning of the week they switched it on finds them not due ...
    const nextMonday = monday(6, 1);
    expect(stamp.getTime()).toBeLessThan(nextMonday.getTime());
    // ... and on next Monday they are.
    expect((await sendWeeklyBriefEmails(nextMonday)).sent).toBe(1);
    expect(sentEmails(spy)).toHaveLength(1);
  });

  it("does nothing and stamps nothing while email is not set up", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    goDormant();
    const spy = mockEmailFetchOk();

    expect(await sendWeeklyBriefEmails(monday(6))).toEqual({ people: 0, sent: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(await stampOf(fixture.engineerActor.userId)).toBeNull();
  });

  it("writes no audit row and no notification row", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    mockEmailFetchOk();
    const audit = await prisma.activityLog.count();
    const notifications = await prisma.notification.count();

    expect((await sendWeeklyBriefEmails(monday(6))).sent).toBe(1);

    expect(await prisma.activityLog.count()).toBe(audit);
    expect(await prisma.notification.count()).toBe(notifications);
  });

  it("runs for a company with no chat channel at all, from the real sweep", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    expect(await prisma.orgIntegration.count()).toBe(0);
    const spy = mockEmailFetchOk();

    await runSweepOnce(monday(6));

    expect(sentEmails(spy).filter((email) => email.subject.startsWith("This week's brief"))).toHaveLength(1);
  });

  it("logs a failure with the purpose and the person's id only", async () => {
    const address = await optIn(fixture.engineerActor.userId, { alerts: false, weekly: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 500 }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await sendWeeklyBriefEmails(monday(6));

    const call = warn.mock.calls.find((entry) => entry[0] === "Could not send an email");
    expect(call?.[1]).toMatchObject({ purpose: "WEEKLY_BRIEF", userId: fixture.engineerActor.userId });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(address);
    expect(await stampOf(fixture.engineerActor.userId)).toEqual(monday(6));
  });
});
