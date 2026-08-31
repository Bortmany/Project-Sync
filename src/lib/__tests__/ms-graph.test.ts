// The rules of the road for Microsoft 365, tested without a database and without a network:
// what switches the feature on, which addresses may ever be called, and that a stored secret
// cannot be read or edited by anyone holding only the database.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REDIRECT_PATH,
  isAllowedDownloadUrl,
  isMicrosoftConfigured,
  microsoftConfig,
  microsoftUrlProblem,
  readIdToken,
} from "@/lib/ms-graph";
import { open, seal, secretBoxAvailable } from "@/lib/secret-box";

/** A pretend environment. NODE_ENV is always present, exactly as it is in a real one. */
const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({ NODE_ENV: "test", ...values }) as NodeJS.ProcessEnv;

const FULL_ENV = env({
  MS_GRAPH_CLIENT_ID: "client-id",
  MS_GRAPH_CLIENT_SECRET: "client-secret",
  APP_BASE_URL: "https://tielora.test/",
});

describe("switching the feature on", () => {
  it("stays dormant until BOTH the client id and the secret are set", () => {
    expect(microsoftConfig(env({}))).toBeNull();
    expect(microsoftConfig(env({ MS_GRAPH_CLIENT_ID: "client-id" }))).toBeNull();
    expect(microsoftConfig(env({ MS_GRAPH_CLIENT_SECRET: "client-secret" }))).toBeNull();
    expect(isMicrosoftConfigured(env({}))).toBe(false);
  });

  it("builds the callback address from APP_BASE_URL, without a trailing slash", () => {
    const config = microsoftConfig(FULL_ENV);
    expect(config?.redirectPath).toBe(DEFAULT_REDIRECT_PATH);
    expect(config?.redirectUri).toBe(`https://tielora.test${DEFAULT_REDIRECT_PATH}`);
  });

  it("has no callback address at all until APP_BASE_URL is set", () => {
    const config = microsoftConfig({ ...FULL_ENV, APP_BASE_URL: undefined });
    expect(config?.redirectUri).toBeNull();
  });

  it("ignores a redirect path that is not a path", () => {
    const config = microsoftConfig({ ...FULL_ENV, MS_GRAPH_REDIRECT_PATH: "https://evil.example/x" });
    expect(config?.redirectPath).toBe(DEFAULT_REDIRECT_PATH);
  });
});

describe("which addresses may be called", () => {
  it("allows only Microsoft's two hosts, over https, with no credentials or port", () => {
    expect(microsoftUrlProblem("https://graph.microsoft.com/v1.0/me/drives")).toBeNull();
    expect(microsoftUrlProblem("https://login.microsoftonline.com/organizations/oauth2/v2.0/token")).toBeNull();

    for (const bad of [
      "http://graph.microsoft.com/v1.0/me",
      "https://graph.microsoft.com.evil.example/v1.0/me",
      "https://user:pass@graph.microsoft.com/v1.0/me",
      "https://graph.microsoft.com:8443/v1.0/me",
      "https://169.254.169.254/latest/meta-data",
      "not a url at all",
    ]) {
      expect(microsoftUrlProblem(bad)).not.toBeNull();
    }
  });

  it("follows a download only to a Microsoft content host", () => {
    expect(isAllowedDownloadUrl("https://contoso.sharepoint.com/personal/x")).toBe(true);
    expect(isAllowedDownloadUrl("https://public.bn1301.livefilestore.svc.ms/y")).toBe(true);
    expect(isAllowedDownloadUrl("https://contoso-my.sharepoint.com/download")).toBe(true);

    expect(isAllowedDownloadUrl("https://files.evil.example/x")).toBe(false);
    expect(isAllowedDownloadUrl("https://sharepoint.com.evil.example/x")).toBe(false);
    expect(isAllowedDownloadUrl("http://contoso.sharepoint.com/x")).toBe(false);
    expect(isAllowedDownloadUrl("https://user:pass@contoso.sharepoint.com/x")).toBe(false);
    // Same rule as the two API hosts: a port nobody serves content from is refused, not dialled.
    expect(isAllowedDownloadUrl("https://contoso.sharepoint.com:8443/x")).toBe(false);
  });

  it("reads the tenant and the work domain from an id token, and never throws on rubbish", () => {
    const payload = Buffer.from(
      JSON.stringify({ tid: "tenant-1", preferred_username: "admin@contoso.com" }),
    ).toString("base64url");
    expect(readIdToken(`header.${payload}.signature`)).toEqual({
      tid: "tenant-1",
      domain: "contoso.com",
    });
    expect(readIdToken(undefined)).toEqual({ tid: null, domain: null });
    expect(readIdToken("nonsense")).toEqual({ tid: null, domain: null });
  });
});

describe("a stored secret", () => {
  const previous = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "a-long-enough-test-session-secret-0123456789";
  });

  afterEach(() => {
    process.env.SESSION_SECRET = previous;
  });

  it("round-trips, hides the plain text, and is different every time", () => {
    expect(secretBoxAvailable()).toBe(true);

    const sealed = seal("microsoft.refresh-token", "the-refresh-token");
    expect(sealed).not.toContain("the-refresh-token");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(open("microsoft.refresh-token", sealed)).toBe("the-refresh-token");
    expect(seal("microsoft.refresh-token", "the-refresh-token")).not.toBe(sealed);
  });

  it("refuses a value that was edited, or opened for a different purpose", () => {
    const sealed = seal("microsoft.refresh-token", "the-refresh-token");
    const parts = sealed.split(".");
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join(".");

    expect(() => open("microsoft.refresh-token", tampered)).toThrow();
    expect(() => open("microsoft.access-token", sealed)).toThrow();
    expect(() => open("microsoft.refresh-token", "not-a-sealed-value")).toThrow();
  });

  it("refuses to seal anything at all without a real SESSION_SECRET", () => {
    process.env.SESSION_SECRET = "short";
    expect(secretBoxAvailable()).toBe(false);
    expect(() => seal("microsoft.refresh-token", "x")).toThrow(/SESSION_SECRET/);

    // The floor is the same 32 characters house rule 11 sets for the secret itself — a 31-character
    // one is refused, a 32-character one is accepted.
    process.env.SESSION_SECRET = "x".repeat(31);
    expect(secretBoxAvailable()).toBe(false);
    process.env.SESSION_SECRET = "x".repeat(32);
    expect(secretBoxAvailable()).toBe(true);
  });
});
