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
import { SaveIntegrationInput, maskWebhookUrl, webhookUrlProblem } from "@/lib/zod-schemas";
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
    };
    await setEventToggles(fixture.adminActor, { kind: "SLACK", eventToggles: chosen });

    // Pasting a fresh address is not consent to start sending the four things they switched off.
    const replaced = await saveIntegration(fixture.adminActor, {
      kind: "SLACK",
      webhookUrl: "https://hooks.slack.com/services/TNEW/BNEW/AnotherSecretTokenValue",
    });

    expect(replaced.eventToggles).toEqual(chosen);
  });

  it("starts switched off with every event on, so nothing is sent until it is turned on", async () => {
    const saved = await saveIntegration(fixture.adminActor, { kind: "TEAMS", webhookUrl: TEAMS_URL });
    expect(saved.enabled).toBe(false);
    expect(saved.eventToggles).toEqual({
      taskAssigned: true,
      mention: true,
      statusChange: true,
      overdueReminder: true,
      gateOverride: true,
    });
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
