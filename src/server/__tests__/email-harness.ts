// Shared pieces for the alert and brief email tests: switching email on and off, a fake Resend,
// and opting a test person in. Nothing here ever touches the network — global.fetch is replaced.

import { vi } from "vitest";
import { prisma } from "@/lib/db";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const EMAIL_BASE = "https://tielora.example";

export function configureEmail(): void {
  process.env.RESEND_API_KEY = "re_Sup3rSecretResendKeyValue";
  process.env.EMAIL_FROM = "Tielora <no-reply@tielora.example>";
  process.env.APP_BASE_URL = EMAIL_BASE;
}

export function goDormant(): void {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.APP_BASE_URL;
}

/** Everything goes 200 OK — Resend and any chat webhook alike. */
export function mockFetchOk() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
}

export type SentEmail = {
  to: string[];
  subject: string;
  text: string;
  headers?: Record<string, string>;
};

/** The emails the fake Resend received, parsed, in order. Chat posts are left out. */
export function sentEmails(spy: { mock: { calls: unknown[][] } }): SentEmail[] {
  return spy.mock.calls
    .filter((call) => String(call[0]) === RESEND_ENDPOINT)
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as SentEmail);
}

/** Lets the not-awaited email copies finish. */
export function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sets a test person's email choices, confirmed address by default. Returns their address. */
export async function optIn(
  userId: string,
  choices: { alerts?: boolean; daily?: boolean; weekly?: boolean; verified?: boolean } = {},
): Promise<string> {
  const row = await prisma.user.update({
    where: { id: userId },
    data: {
      emailAlerts: choices.alerts ?? true,
      emailDailyBrief: choices.daily ?? false,
      emailWeeklyBrief: choices.weekly ?? false,
      emailVerifiedAt: choices.verified === false ? null : new Date(),
    },
    select: { email: true },
  });
  return row.email;
}
