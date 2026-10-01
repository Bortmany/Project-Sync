// The model call for a digest summary is never given more time than the sweep has left.
// The model module is replaced, so nothing here touches the network or the database.

import { beforeEach, describe, expect, it, vi } from "vitest";

const generateDigestSummary = vi.fn();
vi.mock("@/server/services/ai", () => ({
  DIGEST_TIMEOUT_MS: 15_000,
  containsLink: (text: string) => /https?:\/\//.test(text),
  generateDigestSummary: (...args: unknown[]) => generateDigestSummary(...args),
}));

import { withAiSummary } from "@/server/services/ai-digest";

const message = { title: "Daily brief", body: "• TEST-1 — 40%" } as Parameters<typeof withAiSummary>[1];

beforeEach(() => {
  generateDigestSummary.mockReset();
  generateDigestSummary.mockResolvedValue("All fine.");
});

describe("the summary call's time limit", () => {
  it("is 15 seconds when the sweep has plenty left", async () => {
    await withAiSummary("org", message, new Date(), 30_000);
    expect(generateDigestSummary.mock.calls[0][2]).toMatchObject({ timeoutMs: 15_000 });
  });

  it("never passes more than the sweep has left", async () => {
    for (const left of [1_000, 4_321, 14_999, 15_000, 20_000]) {
      generateDigestSummary.mockClear();
      await withAiSummary("org", message, new Date(), left);
      const { timeoutMs } = generateDigestSummary.mock.calls[0][2] as { timeoutMs: number };
      expect(timeoutMs).toBeLessThanOrEqual(left);
      expect(timeoutMs).toBeLessThanOrEqual(15_000);
    }
  });

  it("makes no call with under one second left", async () => {
    await withAiSummary("org", message, new Date(), 999);
    expect(generateDigestSummary).not.toHaveBeenCalled();
  });
});
