// The AI-written summary above the company chat digests (daily and weekly), with the provider and
// the chat tools both mocked: NOTHING here reaches the network. Asserted:
//  - switch off or no key: no model call, a digest byte-for-byte the one it always was;
//  - on and inside the allowance: a labelled summary above the computed lines, which are unchanged;
//  - provider error, timeout, cap reached: the identical computed digest, no note;
//  - a reply holding any link or email address is dropped, so the summary never links;
//  - the once-a-day / once-a-week stamp means one model call per company per period;
//  - the model only sees the company's own lines, and a "Your day" brief is untouched.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { DEFAULT_EVENT_TOGGLES } from "@/lib/zod-schemas";
import { AI_SUMMARY_LABEL, AI_SUMMARY_MAX_CHARS } from "@/server/services/ai-digest";
import { monthKey } from "@/server/services/ai";
import { personBrief } from "@/server/services/briefs";
import { saveIntegration, setEventToggles, setIntegrationEnabled } from "@/server/services/integrations";
import { createMainTask } from "@/server/services/tasks";
import { postDailyDigests, postWeeklyBriefs } from "@/server/sweep";
import {
  AI_TEST_KEY,
  anthropicError,
  anthropicReply,
  expectNoKey,
  goDormantAi,
  installFakeAnthropic,
  sentText,
  switchAiOn,
} from "@/server/__tests__/ai-harness";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  resetDatabase,
  type Fixture,
} from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

const SLACK_URL = "https://hooks.slack.com/services/T00000000/B00000000/Sup3rSecretT0kenValue";
const TEAMS_URL =
  "https://prod-07.westeurope.logic.azure.com:443/workflows/9f3/triggers/manual/paths/invoke?api-version=2016-06-01&sv=1.0&sig=Sup3rSecretSignatureValue";
const HOUR = 60 * 60 * 1000;

let fixture: Fixture;
let reply: () => Promise<Response> | Response;
let fetchMock: ReturnType<typeof installFakeAnthropic>;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
  await switchAiOn(fixture.orgId);
  reply = () => anthropicReply("Everything is on track except two blocked tasks.");
  // Chat posts get a 200; everything else is the provider and gets `reply`.
  fetchMock = installFakeAnthropic((url) =>
    url.includes("anthropic") ? reply() : new Response("ok", { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const morning = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6));
};
const monday = (hours: number, weeks = 0): Date => {
  const now = new Date();
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday + 7 * weeks) +
      hours * HOUR,
  );
};

async function connect(
  kind: "SLACK" | "TEAMS",
  url: string,
  toggles: { dailyBrief?: boolean; weeklyBrief?: boolean },
) {
  await saveIntegration(fixture.adminActor, { kind, webhookUrl: url });
  await setIntegrationEnabled(fixture.adminActor, { kind, enabled: true });
  await setEventToggles(fixture.adminActor, {
    kind,
    eventToggles: { ...DEFAULT_EVENT_TOGGLES, dailyBrief: false, weeklyBrief: false, ...toggles },
  });
}

async function addWork(f: Fixture = fixture, title = "Design review") {
  const deadline = inThirtyDays();
  return createMainTask(f.adminActor, {
    projectId: f.projectId,
    phaseId: null,
    title,
    description: "Work for the digest tests.",
    priority: "MEDIUM",
    deadline,
    ownerId: f.pmActor.userId,
    disciplineTasks: [
      {
        disciplineId: f.disciplineId,
        title: "Some work",
        assigneeId: f.engineerActor.userId,
        deadline,
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
}

type Post = {
  blocks: { text: { text: string } }[];
  attachments: { content: { body: { text: string }[] } }[];
};

const providerCallIndexes = () =>
  fetchMock.mock.calls.flatMap((call, index) => (String(call[0]).includes("anthropic") ? [index] : []));
const providerCalls = () => providerCallIndexes();
const postsTo = (url: string) =>
  fetchMock.mock.calls
    .filter((call) => String(call[0]) === url)
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Post);

const slackText = (post: Post): string => post.blocks[1].text.text;
const teamsText = (post: Post): string => post.attachments[0].content.body[1].text;

/** Lets the next sweep run again for the same day, with a clean call record. */
async function resetStamps() {
  await prisma.orgIntegration.updateMany({ data: { dailyBriefSentAt: null, weeklyBriefSentAt: null } });
  fetchMock.mockClear();
}

/** The digest the channel receives with no AI at all, as the reference to compare with. */
async function plainDaily(): Promise<string> {
  goDormantAi();
  await postDailyDigests(morning());
  const text = slackText(postsTo(SLACK_URL)[0]);
  await resetStamps();
  vi.stubEnv("ANTHROPIC_API_KEY", AI_TEST_KEY);
  return text;
}

describe("the daily digest with an AI summary", () => {
  beforeEach(async () => {
    await addWork();
    await connect("SLACK", SLACK_URL, { dailyBrief: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    fetchMock.mockClear();
  });

  it("puts a labelled summary above the unchanged computed lines, with no audit row", async () => {
    const plain = await plainDaily();
    const auditBefore = await prisma.activityLog.count();
    await postDailyDigests(morning());

    expect(providerCalls()).toHaveLength(1);
    const text = slackText(postsTo(SLACK_URL)[0]);
    expect(
      text.startsWith(`${AI_SUMMARY_LABEL}: Everything is on track except two blocked tasks.\n\n`),
    ).toBe(true);
    expect(text.endsWith(plain)).toBe(true);
    expect(await prisma.activityLog.count()).toBe(auditBefore);
  });

  it("makes no call and sends the identical digest when the switch is off", async () => {
    const plain = await plainDaily();
    await prisma.organization.update({ where: { id: fixture.orgId }, data: { aiBriefs: false } });
    await postDailyDigests(morning());
    expect(providerCalls()).toHaveLength(0);
    expect(slackText(postsTo(SLACK_URL)[0])).toBe(plain);
  });

  const failures: [string, () => Promise<void> | void][] = [
    ["dormant (no key)", () => goDormantAi()],
    ["a provider error", () => void (reply = () => anthropicError(500))],
    [
      "a timeout",
      () =>
        void (reply = () =>
          Promise.reject(Object.assign(new Error("timed out"), { name: "AbortError" }))),
    ],
    [
      "the monthly cap reached",
      async () => {
        await prisma.aiUsage.create({
          data: {
            orgId: fixture.orgId,
            month: monthKey(new Date()),
            inputTokens: 0,
            outputTokens: 2_000_000_000,
            requests: 1,
          },
        });
      },
    ],
  ];
  for (const [name, setUp] of failures) {
    it(`sends the identical computed digest on ${name}`, async () => {
      const plain = await plainDaily();
      await setUp();
      const run = await postDailyDigests(morning());
      expect(run.channels).toBe(1);
      const text = slackText(postsTo(SLACK_URL)[0]);
      expect(text).toBe(plain);
    });
  }

  it("drops a summary that holds a link in Slack syntax, and sends the plain digest", async () => {
    const plain = await plainDaily();
    reply = () => anthropicReply("Open <https://evil.example|click> now & [x](https://evil.example)");
    await postDailyDigests(morning());
    expect(slackText(postsTo(SLACK_URL)[0])).toBe(plain);
  });

  it("drops a summary that holds a link when the channel is Teams", async () => {
    await prisma.orgIntegration.deleteMany({});
    await connect("TEAMS", TEAMS_URL, { dailyBrief: true });
    reply = () => anthropicReply("Click [x](https://evil.example) <https://evil.example|go>");
    await postDailyDigests(morning());
    expect(teamsText(postsTo(TEAMS_URL)[0])).not.toContain(AI_SUMMARY_LABEL);
    expect(teamsText(postsTo(TEAMS_URL)[0])).not.toContain("evil.example");
  });

  for (const [name, words] of [
    ["a bare https address", "See https://evil.example for details."],
    ["a bare http address", "See http://evil.example for details."],
    ["a www. address", "See www.evil.example for details."],
    ["a domain with a path", "See evil.com/offer for details."],
    ["an email address", "Write to boss@evil.example about it."],
  ] as const) {
    it(`gives no summary when the reply holds ${name}`, async () => {
      const plain = await plainDaily();
      reply = () => anthropicReply(words);
      await postDailyDigests(morning());
      const text = slackText(postsTo(SLACK_URL)[0]);
      expect(text).toBe(plain);
      expect(text).not.toContain(AI_SUMMARY_LABEL);
    });
  }

  it("gives no summary when the model ran out of room mid-sentence", async () => {
    const plain = await plainDaily();
    reply = () => anthropicReply("Everything is on", { stopReason: "max_tokens" });
    await postDailyDigests(morning());
    expect(slackText(postsTo(SLACK_URL)[0])).toBe(plain);
  });

  it("caps the summary at 350 characters", async () => {
    reply = () => anthropicReply("word ".repeat(200));
    await postDailyDigests(morning());
    const first = slackText(postsTo(SLACK_URL)[0]).split("\n\n")[0];
    expect(first.length).toBeLessThanOrEqual(`${AI_SUMMARY_LABEL}: `.length + AI_SUMMARY_MAX_CHARS);
    expect(first.endsWith("…")).toBe(true);
  });

  it("calls the model once per company per day, however many runs and channels", async () => {
    await connect("TEAMS", TEAMS_URL, { dailyBrief: true });
    await postDailyDigests(morning());
    await postDailyDigests(new Date(morning().getTime() + HOUR));
    expect(providerCalls()).toHaveLength(1);
    await postDailyDigests(new Date(morning().getTime() + 24 * HOUR));
    expect(providerCalls()).toHaveLength(2);
  });

  it("still stamps the company when the summary is null, so there is no second try that day", async () => {
    reply = () => anthropicError(500);
    await postDailyDigests(morning());
    await postDailyDigests(new Date(morning().getTime() + HOUR));
    expect(providerCalls()).toHaveLength(1);
    expect(postsTo(SLACK_URL)).toHaveLength(1);
  });

  it("makes no model call when the sweep's time budget is already spent", async () => {
    await postDailyDigests(morning(), 0);
    expect(providerCalls()).toHaveLength(0);
    expect(postsTo(SLACK_URL)).toHaveLength(1);
  });

  it("sends the model only this company's lines, never another company's", async () => {
    const other = await makeOrg("Other Company");
    const otherFixture = await makeProjectFixture(other.id);
    await prisma.project.update({ where: { id: otherFixture.projectId }, data: { name: "ZZ-OTHER-SECRET" } });
    await addWork(otherFixture, "Other secret work");
    await postDailyDigests(morning());
    expect(providerCalls()).toHaveLength(1);
    const sent = sentText(fetchMock, providerCallIndexes()[0]);
    expect(sent).not.toContain("ZZ-OTHER-SECRET");
    expect(sent).not.toContain("Other secret work");
    expectNoKey(slackText(postsTo(SLACK_URL)[0]));
  });

  it("leaves a person's own 'Your day' brief free of any AI text", async () => {
    reply = () => anthropicReply("AI-WORDS-MARKER");
    await postDailyDigests(morning());
    const brief = await personBrief(fixture.engineerActor);
    expect(JSON.stringify(brief)).not.toContain("AI-WORDS-MARKER");
    expect(JSON.stringify(brief)).not.toContain(AI_SUMMARY_LABEL);
  });
});

describe("the weekly digest with an AI summary", () => {
  beforeEach(async () => {
    await addWork();
    await connect("SLACK", SLACK_URL, { weeklyBrief: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    fetchMock.mockClear();
  });

  it("adds a labelled summary and calls the model once per week", async () => {
    await postWeeklyBriefs(monday(6));
    await postWeeklyBriefs(monday(7));
    expect(providerCalls()).toHaveLength(1);
    expect(slackText(postsTo(SLACK_URL)[0]).startsWith(`${AI_SUMMARY_LABEL}: `)).toBe(true);
    await postWeeklyBriefs(monday(6, 1));
    expect(providerCalls()).toHaveLength(2);
  });

  it("is identical to the plain weekly digest when the provider fails or the switch is off", async () => {
    goDormantAi();
    await postWeeklyBriefs(monday(6));
    const plain = slackText(postsTo(SLACK_URL)[0]);

    await resetStamps();
    vi.stubEnv("ANTHROPIC_API_KEY", AI_TEST_KEY);
    reply = () => anthropicError(500);
    await postWeeklyBriefs(monday(6));
    expect(slackText(postsTo(SLACK_URL)[0])).toBe(plain);

    await resetStamps();
    await prisma.organization.update({ where: { id: fixture.orgId }, data: { aiBriefs: false } });
    await postWeeklyBriefs(monday(6));
    expect(providerCalls()).toHaveLength(0);
    expect(slackText(postsTo(SLACK_URL)[0])).toBe(plain);
  });

  it("drops a reply that holds a link", async () => {
    reply = () => anthropicReply("<https://evil.example|click>");
    await postWeeklyBriefs(monday(6));
    expect(slackText(postsTo(SLACK_URL)[0])).not.toContain("<https://evil");
  });
});
