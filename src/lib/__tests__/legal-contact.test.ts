// The operator contact printed on /privacy and /terms: the owner's address unless the deployment
// says otherwise, and a blank setting counts as "not set".

import { describe, expect, it } from "vitest";

import { DEFAULT_PRIVACY_CONTACT_EMAIL, privacyContactEmail } from "@/lib/legal-contact";

describe("privacyContactEmail", () => {
  it("falls back to the owner's address when PRIVACY_CONTACT_EMAIL is unset", () => {
    expect(privacyContactEmail({})).toBe(DEFAULT_PRIVACY_CONTACT_EMAIL);
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: undefined })).toBe(DEFAULT_PRIVACY_CONTACT_EMAIL);
    expect(DEFAULT_PRIVACY_CONTACT_EMAIL).toBe("naeljam@hotmail.com");
  });

  it("treats a blank or whitespace-only setting as unset", () => {
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: "" })).toBe(DEFAULT_PRIVACY_CONTACT_EMAIL);
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: "   " })).toBe(DEFAULT_PRIVACY_CONTACT_EMAIL);
  });

  it("uses the configured address when one is set, with surrounding spaces forgiven", () => {
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: "privacy@example.com" })).toBe("privacy@example.com");
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: "  privacy@example.com \n" })).toBe("privacy@example.com");
  });
});
