// The sign-in page and its second door, "Sign in with Microsoft".
//
// Render tests, like public-pages.test.tsx: the one session read is mocked, and the router the form
// asks for is stubbed because there is no app router in a plain render. They pin three promises:
//
//  1. DORMANT MEANS BYTE FOR BYTE. While MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET are unset the
//     page carries no trace of Microsoft, and a `?microsoft=failed` in the address changes nothing.
//  2. Set up, the page offers the button, the grey line and a real link to /api/auth/microsoft.
//  3. A refused Microsoft sign-in says exactly what a wrong password says — the one shared constant.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SIGN_IN_REFUSED_MESSAGE } from "@/lib/sign-in-messages";

vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => null,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
}));

const { default: LoginPage } = await import("@/app/(auth)/login/page");

const saved = {
  id: process.env.MS_GRAPH_CLIENT_ID,
  secret: process.env.MS_GRAPH_CLIENT_SECRET,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function loginHtml(params: { done?: string; microsoft?: string } = {}): Promise<string> {
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));
}

afterEach(() => {
  restore("MS_GRAPH_CLIENT_ID", saved.id);
  restore("MS_GRAPH_CLIENT_SECRET", saved.secret);
});

describe("the login page while Microsoft is not set up", () => {
  beforeEach(() => {
    delete process.env.MS_GRAPH_CLIENT_ID;
    delete process.env.MS_GRAPH_CLIENT_SECRET;
  });

  it("carries no trace of Microsoft at all", async () => {
    const html = await loginHtml();

    expect(html).not.toMatch(/microsoft/i);
    expect(html).not.toContain("/api/auth/microsoft");
    expect(html).not.toContain("administrator has switched it on");
    expect(html).toContain("Sign in");
  });

  it("ignores ?microsoft=failed completely — identical HTML, no message", async () => {
    const plain = await loginHtml();
    const failed = await loginHtml({ microsoft: "failed" });

    expect(failed).toBe(plain);
    expect(failed).not.toContain(SIGN_IN_REFUSED_MESSAGE);
  });

  it("is not switched on by only half of the registration", async () => {
    process.env.MS_GRAPH_CLIENT_ID = "client-id-only";
    const halfSet = await loginHtml({ microsoft: "failed" });

    delete process.env.MS_GRAPH_CLIENT_ID;
    expect(halfSet).toBe(await loginHtml());
  });
});

describe("the login page once Microsoft is set up", () => {
  beforeEach(() => {
    process.env.MS_GRAPH_CLIENT_ID = "test-client-id";
    process.env.MS_GRAPH_CLIENT_SECRET = "test-client-secret";
  });

  it("offers the button, the grey line and a real link to start a Microsoft sign-in", async () => {
    const html = await loginHtml();

    expect(html).toContain("Sign in with Microsoft");
    expect(html).toContain("Works once your company’s administrator has switched it on.");
    expect(html).toContain('href="/api/auth/microsoft"');
    expect(html).toContain("/brand/microsoft-logo.svg");
    // Below the password form: the ordinary Sign in button comes first.
    expect(html.indexOf("Forgot password?")).toBeLessThan(html.indexOf("Sign in with Microsoft"));
    // Nothing refused, so no refusal.
    expect(html).not.toContain(SIGN_IN_REFUSED_MESSAGE);
  });

  it("answers ?microsoft=failed with exactly the wrong-password sentence, once", async () => {
    const html = await loginHtml({ microsoft: "failed" });

    expect(html.split(SIGN_IN_REFUSED_MESSAGE)).toHaveLength(2);
    expect(html).toContain(`role="alert"`);
    // Under the subline, above the email field.
    expect(html.indexOf(SIGN_IN_REFUSED_MESSAGE)).toBeLessThan(html.indexOf("Email"));
    // Any other value is not a refusal.
    expect(await loginHtml({ microsoft: "something-else" })).not.toContain(
      SIGN_IN_REFUSED_MESSAGE,
    );
  });

  it("reads the two-factor ticket from the same fragment key the callback writes", async () => {
    const { TWO_FACTOR_FRAGMENT_KEY } = await import("@/app/api/auth/microsoft/attempt-cookie");
    const { MICROSOFT_TICKET_FRAGMENT_KEY } = await import("@/app/(auth)/login/login-form");

    expect(MICROSOFT_TICKET_FRAGMENT_KEY).toBe(TWO_FACTOR_FRAGMENT_KEY);
  });
});

describe("Microsoft's logo colours", () => {
  it("live only inside the SVG picture file, never in a style, component or class", () => {
    const hex = /#?(f25022|7fba00|00a4ef|ffb900)/i;
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "generated" && name !== "__tests__") walk(path);
        } else if (/\.(css|tsx?|jsx?)$/.test(name) && hex.test(readFileSync(path, "utf8"))) {
          offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), "src"));

    expect(offenders).toEqual([]);
    expect(readFileSync(join(process.cwd(), "public/brand/microsoft-logo.svg"), "utf8")).toMatch(hex);
  });
});
