// The one-time password maths, against the standard's own numbers.
//
// RFC 6238 Appendix B publishes a table of codes for a known secret at known moments. If this file
// passes, an authenticator app and this app agree about what the six digits are — which is the whole
// of what two-factor sign-in rests on.

import { describe, expect, it } from "vitest";
import {
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  stepAt,
  totpCode,
  verifyTotpCode,
} from "@/lib/totp";

/** The RFC's own SHA-1 seed: the ASCII digits 1234567890, twenty bytes of them. */
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

/** Appendix B, the SHA-1 rows, each cut to the six digits this app uses. */
const RFC_VECTORS: Array<{ unixSeconds: number; code: string }> = [
  { unixSeconds: 59, code: "287082" },
  { unixSeconds: 1111111109, code: "081804" },
  { unixSeconds: 1111111111, code: "050471" },
  { unixSeconds: 1234567890, code: "005924" },
  { unixSeconds: 2000000000, code: "279037" },
  { unixSeconds: 20000000000, code: "353130" },
];

describe("RFC 6238 test vectors", () => {
  for (const vector of RFC_VECTORS) {
    it(`matches the published code at ${vector.unixSeconds}`, () => {
      const step = stepAt(vector.unixSeconds * 1000);
      expect(totpCode(RFC_SECRET, step)).toBe(vector.code);
    });
  }

  it("accepts each published code at the moment it belongs to", () => {
    for (const vector of RFC_VECTORS) {
      const at = vector.unixSeconds * 1000;
      expect(verifyTotpCode(RFC_SECRET, vector.code, { at })).toBe(stepAt(at));
    }
  });

  it("always returns six digits, zero-padded", () => {
    const secret = generateTotpSecret();
    for (let step = 0; step < 500; step += 1) {
      expect(totpCode(secret, step)).toMatch(/^\d{6}$/);
    }
  });
});

describe("base32", () => {
  it("matches the RFC 4648 example", () => {
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
  });

  it("comes back as the bytes it went in as", () => {
    for (let length = 1; length <= 32; length += 1) {
      const bytes = generateTotpSecret().subarray(0, length);
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
  });

  it("forgives spaces, hyphens, lower case and padding", () => {
    const bytes = Buffer.from("12345678901234567890", "ascii");
    const key = base32Encode(bytes);
    const messy = `${key.slice(0, 4)} ${key.slice(4, 8)}-${key.slice(8).toLowerCase()}==`;
    expect(base32Decode(messy).equals(bytes)).toBe(true);
  });

  it("refuses a character that is not in the alphabet", () => {
    expect(() => base32Decode("MZXW6YTB01")).toThrow();
  });
});

describe("the window around now", () => {
  const at = 1_700_000_000_000;
  const now = stepAt(at);

  it("accepts the step before and the step after", () => {
    expect(verifyTotpCode(RFC_SECRET, totpCode(RFC_SECRET, now - 1), { at })).toBe(now - 1);
    expect(verifyTotpCode(RFC_SECRET, totpCode(RFC_SECRET, now), { at })).toBe(now);
    expect(verifyTotpCode(RFC_SECRET, totpCode(RFC_SECRET, now + 1), { at })).toBe(now + 1);
  });

  it("refuses two steps out in either direction", () => {
    expect(verifyTotpCode(RFC_SECRET, totpCode(RFC_SECRET, now - 2), { at })).toBeNull();
    expect(verifyTotpCode(RFC_SECRET, totpCode(RFC_SECRET, now + 2), { at })).toBeNull();
  });

  it("refuses a step that has already been used, however good the digits are", () => {
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotpCode(RFC_SECRET, code, { at, afterStep: now - 1 })).toBe(now);
    expect(verifyTotpCode(RFC_SECRET, code, { at, afterStep: now })).toBeNull();
    expect(verifyTotpCode(RFC_SECRET, code, { at, afterStep: now + 5 })).toBeNull();
  });

  it("refuses anything that is not six digits", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5", "12345a"]) {
      expect(verifyTotpCode(RFC_SECRET, bad, { at })).toBeNull();
    }
  });

  it("tidies the spaces people type between the two groups", () => {
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotpCode(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { at })).toBe(now);
  });

  it("counts a step as thirty seconds", () => {
    expect(stepAt(at + TOTP_STEP_SECONDS * 1000) - stepAt(at)).toBe(1);
  });
});

describe("the otpauth address", () => {
  it("names the issuer in the label and the query", () => {
    const url = otpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      accountName: "aisha@northern.example",
      issuer: "Tielora",
    });

    expect(url.startsWith("otpauth://totp/Tielora:aisha%40northern.example?")).toBe(true);
    const query = new URL(url).searchParams;
    expect(query.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(query.get("issuer")).toBe("Tielora");
    expect(query.get("digits")).toBe("6");
    expect(query.get("period")).toBe("30");
    expect(query.get("algorithm")).toBe("SHA1");
  });
});
