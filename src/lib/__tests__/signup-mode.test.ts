// The sign-up door: closed by default in production, invite-only while codes exist, open only on
// the explicit flag — and open in development and test so nothing about the existing run changes.

import { describe, expect, it, vi } from "vitest";

// Watch every constant-time comparison the module makes, without changing what it returns.
const { compared } = vi.hoisted(() => ({ compared: [] as Array<[Buffer, Buffer]> }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    timingSafeEqual: (a: Buffer, b: Buffer) => {
      compared.push([a, b]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

import {
  inviteCodeAccepted,
  inviteCodes,
  MIN_INVITE_CODE_LENGTH,
  SIGNUP_CLOSED_MESSAGE,
  SIGNUP_INVITE_MESSAGE,
  signupMode,
  signupRefusal,
} from "@/lib/signup-mode";

const CODES = "alpha-2026-code, beta-2026-code";

describe("signupMode", () => {
  it("is CLOSED in production when nothing is set — the safe default", () => {
    expect(signupMode({ NODE_ENV: "production" })).toBe("closed");
    expect(signupMode({ NODE_ENV: "production", SIGNUPS_OPEN: "" })).toBe("closed");
    expect(signupMode({ NODE_ENV: "production", SIGNUP_INVITE_CODES: "" })).toBe("closed");
  });

  it("is INVITE in production once a usable code exists", () => {
    expect(signupMode({ NODE_ENV: "production", SIGNUP_INVITE_CODES: CODES })).toBe("invite");
  });

  it("is OPEN only when SIGNUPS_OPEN is literally \"true\", codes or no codes", () => {
    expect(signupMode({ NODE_ENV: "production", SIGNUPS_OPEN: "true" })).toBe("open");
    expect(signupMode({ NODE_ENV: "production", SIGNUPS_OPEN: "true", SIGNUP_INVITE_CODES: CODES })).toBe(
      "open",
    );
    for (const notTrue of ["1", "yes", "TRUE", "True", " true"]) {
      expect(signupMode({ NODE_ENV: "production", SIGNUPS_OPEN: notTrue })).toBe("closed");
    }
  });

  it("stays OPEN in development and test unless codes are set, so a fresh clone still works", () => {
    expect(signupMode({ NODE_ENV: "development" })).toBe("open");
    expect(signupMode({ NODE_ENV: "test" })).toBe("open");
    expect(signupMode({})).toBe("open");
    expect(signupMode({ NODE_ENV: "development", SIGNUP_INVITE_CODES: CODES })).toBe("invite");
    expect(signupMode({ NODE_ENV: "test", SIGNUP_INVITE_CODES: CODES })).toBe("invite");
  });

  it("ignores codes shorter than the minimum, so a weak list is the same as no list", () => {
    const short = "x".repeat(MIN_INVITE_CODE_LENGTH - 1);
    expect(inviteCodes({ SIGNUP_INVITE_CODES: `${short}, , ,` })).toEqual([]);
    expect(signupMode({ NODE_ENV: "production", SIGNUP_INVITE_CODES: short })).toBe("closed");
    expect(inviteCodes({ SIGNUP_INVITE_CODES: ` ${short} , ${"y".repeat(MIN_INVITE_CODE_LENGTH)} ` })).toEqual([
      "y".repeat(MIN_INVITE_CODE_LENGTH),
    ]);
  });
});

describe("inviteCodeAccepted", () => {
  const env = { NODE_ENV: "production", SIGNUP_INVITE_CODES: CODES };

  it("accepts any configured code, with surrounding spaces forgiven", () => {
    expect(inviteCodeAccepted("alpha-2026-code", env)).toBe(true);
    expect(inviteCodeAccepted("beta-2026-code", env)).toBe(true);
    expect(inviteCodeAccepted("  beta-2026-code ", env)).toBe(true);
  });

  it("refuses a wrong, partial, missing or blank code", () => {
    expect(inviteCodeAccepted("alpha-2026-cod", env)).toBe(false);
    expect(inviteCodeAccepted("alpha-2026-code-extra", env)).toBe(false);
    expect(inviteCodeAccepted("ALPHA-2026-CODE", env)).toBe(false);
    expect(inviteCodeAccepted("", env)).toBe(false);
    expect(inviteCodeAccepted(undefined, env)).toBe(false);
    expect(inviteCodeAccepted(null, env)).toBe(false);
  });

  it("accepts nothing at all when no codes are configured", () => {
    expect(inviteCodeAccepted("", { NODE_ENV: "production" })).toBe(false);
    expect(inviteCodeAccepted("anything", { NODE_ENV: "production", SIGNUP_INVITE_CODES: "" })).toBe(false);
  });

  it("compares in constant time: every code is checked, through timingSafeEqual, whatever the guess", () => {
    // A match on the FIRST code must not stop the loop early — same work as a miss.
    compared.length = 0;
    expect(inviteCodeAccepted("alpha-2026-code", env)).toBe(true);
    const onHit = compared.length;
    compared.length = 0;
    expect(inviteCodeAccepted("nothing-like-it", env)).toBe(false);
    const onMiss = compared.length;
    compared.length = 0;
    expect(inviteCodeAccepted("x", env)).toBe(false);
    const onShort = compared.length;

    expect(onHit).toBe(2);
    expect(onMiss).toBe(2);
    expect(onShort).toBe(2);
    // Every comparison is over fixed-length digests, never the raw strings.
    for (const [a, b] of compared) {
      expect(a.length).toBe(32);
      expect(b.length).toBe(32);
    }
  });
});

describe("signupRefusal", () => {
  it("lets everybody through when open, whatever they sent", () => {
    expect(signupRefusal(undefined, { NODE_ENV: "production", SIGNUPS_OPEN: "true" })).toBeNull();
    expect(signupRefusal("garbage", { NODE_ENV: "test" })).toBeNull();
  });

  it("asks for a valid code when invite-only, and the wording names no code", () => {
    const env = { NODE_ENV: "production", SIGNUP_INVITE_CODES: CODES };
    expect(signupRefusal("alpha-2026-code", env)).toBeNull();
    expect(signupRefusal("wrong", env)).toBe(SIGNUP_INVITE_MESSAGE);
    expect(signupRefusal(undefined, env)).toBe(SIGNUP_INVITE_MESSAGE);
    expect(SIGNUP_INVITE_MESSAGE).not.toContain("alpha");
  });

  it("refuses everybody when closed, a right-looking code included", () => {
    expect(signupRefusal("alpha-2026-code", { NODE_ENV: "production" })).toBe(SIGNUP_CLOSED_MESSAGE);
  });
});
