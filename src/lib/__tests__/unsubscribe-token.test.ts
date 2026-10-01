// The one-click unsubscribe token: a signature, not a stored row. Proved here without a database.
//
// The rules: a token round-trips to exactly the person and kind it was made for; any change to any
// part of it is refused; it cannot be moved from one kind to another; and a miss of every shape
// goes down the same path — one HMAC, one constant-time comparison.

import * as crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual), createHmac: vi.fn(actual.createHmac) };
});

import { unsubscribeToken, verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

const SECRET = "a-test-session-secret-that-is-long-enough-000";
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  vi.mocked(crypto.timingSafeEqual).mockClear();
  vi.mocked(crypto.createHmac).mockClear();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
});

const PERSON = "cm1abcdefghijklmnopqrstu";

describe("making and reading a token", () => {
  it("round-trips to exactly the person and the kind it was made for", () => {
    for (const kind of ["ALERTS", "DAILY", "WEEKLY"] as const) {
      const token = unsubscribeToken(PERSON, kind);
      expect(token).not.toBeNull();
      expect(verifyUnsubscribeToken(token)).toEqual({ personId: PERSON, kind });
    }
  });

  it("is the same every time, so every email of a kind carries the same working link", () => {
    expect(unsubscribeToken(PERSON, "ALERTS")).toBe(unsubscribeToken(PERSON, "ALERTS"));
  });

  it("is made of characters that survive a web address untouched", () => {
    expect(unsubscribeToken(PERSON, "DAILY")).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("gives no token at all when there is no secret to sign with", () => {
    delete process.env.SESSION_SECRET;
    expect(unsubscribeToken(PERSON, "ALERTS")).toBeNull();
    expect(verifyUnsubscribeToken(`${PERSON}.ALERTS.${"A".repeat(43)}`)).toBeNull();
  });
});

describe("refusing anything that is not genuine", () => {
  it("refuses a changed signature, a changed person and a changed kind", () => {
    const token = unsubscribeToken(PERSON, "ALERTS") as string;
    const [person, kind, signature] = token.split(".");
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(verifyUnsubscribeToken(`${person}.${kind}.${flipped}`)).toBeNull();
    expect(verifyUnsubscribeToken(`cm1someoneelse00000000000.${kind}.${signature}`)).toBeNull();
    // The wrong kind: an alerts link can never be turned into a daily-brief one.
    expect(verifyUnsubscribeToken(`${person}.DAILY.${signature}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${person}.WEEKLY.${signature}`)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = unsubscribeToken(PERSON, "ALERTS") as string;
    process.env.SESSION_SECRET = `${SECRET}-rotated`;
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("refuses every malformed shape — empty, missing, old single-use style, extra parts", () => {
    const token = unsubscribeToken(PERSON, "ALERTS") as string;
    for (const bad of [
      "",
      null,
      undefined,
      "nonsense",
      "a".repeat(64), // what an EmailToken link carries — the old single-use shape
      `${token}.extra`,
      `${PERSON}.UNKNOWN.${token.split(".")[2]}`,
      `bad id!.ALERTS.${token.split(".")[2]}`,
    ]) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });
});

describe("the same work for a hit and a miss", () => {
  it("does one HMAC and one constant-time comparison whatever arrives", () => {
    const token = unsubscribeToken(PERSON, "ALERTS") as string;
    vi.mocked(crypto.timingSafeEqual).mockClear();
    vi.mocked(crypto.createHmac).mockClear();

    for (const candidate of [token, "nonsense", "", `${PERSON}.DAILY.${token.split(".")[2]}`]) {
      vi.mocked(crypto.timingSafeEqual).mockClear();
      vi.mocked(crypto.createHmac).mockClear();
      verifyUnsubscribeToken(candidate);
      expect(crypto.createHmac).toHaveBeenCalledTimes(1);
      expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    }
  });
});
