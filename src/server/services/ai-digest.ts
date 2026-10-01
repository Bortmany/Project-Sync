// The AI-written summary that may open a company's chat digest (daily or weekly).
//
// The computed lines are the digest and are never changed; this only puts a short, labelled
// paragraph above them. Every way it can fail — no key, switch off, cap reached, provider error,
// slow answer, no room — gives back the very same message object that went in, so the digest goes
// out exactly as it did before. The model's words are untrusted: the chat payload builders escape
// the whole body (`slackEscape` / `teamsEscape`), so a reply can never become a link in a channel, and a reply that holds any address is dropped.
// Writes nothing and audits nothing; the spend is recorded by `generateDigestSummary` itself.

import { DIGEST_TIMEOUT_MS, containsLink, generateDigestSummary } from "@/server/services/ai";
import type { ChatMessage } from "@/server/services/webhooks";

/** The longest the written summary may be, in characters. */
export const AI_SUMMARY_MAX_CHARS = 350;

/** The label above the summary. */
export const AI_SUMMARY_LABEL = "Summary (written by AI)";

/** The shortest slice of the sweep budget in which a model call is still worth starting. */
const MIN_BUDGET_LEFT_MS = 1_000;

/** The computed lines of a digest card, as the model is allowed to see them: only what is printed. */
function printedLines(message: ChatMessage): string[] {
  return message.body
    .split("\n")
    .map((line) => line.replace(/^[•-]\s*/, "").trim())
    .filter(Boolean);
}

/** Collapses the reply to one line and caps it. */
function tidy(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  // The summary never links: with any web or email address in it, there is no summary.
  if (containsLink(oneLine)) return "";
  return oneLine.length <= AI_SUMMARY_MAX_CHARS
    ? oneLine
    : `${oneLine.slice(0, AI_SUMMARY_MAX_CHARS - 1)}…`;
}

/**
 * `message` with the summary on top when there is one and it fits; otherwise `message` itself,
 * untouched. If the whole message would not fit its card, the summary is what is dropped.
 * `budgetLeftMs` is how much of the sweep's time budget remains: with almost none left, no call.
 * Never throws.
 */
export async function withAiSummary(
  orgId: string,
  message: ChatMessage,
  now: Date,
  budgetLeftMs: number,
): Promise<ChatMessage> {
  try {
    if (budgetLeftMs < MIN_BUDGET_LEFT_MS) return message;
    const lines = printedLines(message);
    const raw = await generateDigestSummary(orgId, lines, {
      now,
      // Never longer than the sweep has left.
      timeoutMs: Math.min(DIGEST_TIMEOUT_MS, budgetLeftMs),
    });
    if (!raw) return message;
    const summary = tidy(raw);
    if (!summary) return message;

    const block = `${AI_SUMMARY_LABEL}: ${summary}\n\n`;
    const limit = message.bodyLimit ?? 1_200;
    // Slack turns & into &amp; (five characters) when it escapes, so count the worst case.
    const worst = block.replace(/[&<>]/g, "&amp;").length + message.body.length;
    if (worst > limit) return message;

    return { ...message, body: block + message.body };
  } catch {
    return message;
  }
}
