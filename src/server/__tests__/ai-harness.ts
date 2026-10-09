// Shared helpers for every test that touches Ask Tielora or the AI-written briefs.
//
// NO TEST EVER REACHES ANTHROPIC. The provider module makes its calls through the official SDK,
// which uses the platform `fetch`; these helpers replace that `fetch` with a mock that answers with
// a canned message, and stub the key. Nothing here talks to a network.

import { expect, vi, type Mock } from "vitest";
import { prisma } from "@/lib/db";

/** A recognisable fake key, so a test can prove it never appears in a log, an audit row or an error. */
export const AI_TEST_KEY = "sk-ant-api03-TESTKEY-never-log-me-0123456789";

/** The default canned usage: 1,200 tokens in, 300 out. */
export const DEFAULT_USAGE = { input_tokens: 1200, output_tokens: 300 };

/** A provider message reply, as the SDK expects to read it. */
export function anthropicReply(
  text = "Two discipline tasks are blocked and the next gate is waiting on one main task.",
  options: {
    usage?: { input_tokens: number; output_tokens: number };
    stopReason?: string;
    content?: unknown[];
  } = {},
): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test_0001",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: options.content ?? (text ? [{ type: "text", text }] : []),
      stop_reason: options.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: options.usage ?? DEFAULT_USAGE,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A provider error reply, carrying a message the app must never show or log. */
export function anthropicError(status: number, message = "PROVIDER-SECRET-MESSAGE"): Response {
  return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stubs the key and the platform fetch. Returns the fetch mock; undo with vi.unstubAllEnvs/Globals. */
export function installFakeAnthropic(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response = () => anthropicReply(),
): Mock {
  vi.stubEnv("ANTHROPIC_API_KEY", AI_TEST_KEY);
  const mock = vi.fn(async (url: unknown, init?: RequestInit) => handler(String(url), init ?? {}));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Takes the key away again: a deployment with no AI. */
export function goDormantAi(): void {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
}

/** The request the app sent on call number `index`, parsed. */
export function sentRequest(mock: Mock, index = 0): { url: string; body: Record<string, unknown>; headers: Headers; raw: string } {
  const [url, init] = mock.mock.calls[index] as [unknown, RequestInit];
  const raw = typeof init.body === "string" ? init.body : String(init.body);
  return { url: String(url), body: JSON.parse(raw) as Record<string, unknown>, headers: new Headers(init.headers), raw };
}

/** Everything the app sent in call number `index`, as one string: system message and data block. */
export function sentText(mock: Mock, index = 0): string {
  return sentRequest(mock, index).raw;
}

/** Switches a company's two AI switches on (they are off for every company until an administrator does). */
export async function switchAiOn(orgId: string, options: { assistant?: boolean; briefs?: boolean } = {}): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { aiAssistant: options.assistant ?? true, aiBriefs: options.briefs ?? true },
  });
}

/** Asserts the key shows up nowhere in the given values. */
export function expectNoKey(...values: unknown[]): void {
  for (const value of values) {
    expect(JSON.stringify(value) ?? "").not.toContain(AI_TEST_KEY);
  }
}
