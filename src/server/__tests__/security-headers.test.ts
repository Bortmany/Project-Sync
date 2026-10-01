// FRAMING IS ALLOWED FOR EXACTLY ONE PAGE. Every page and every API route answers
// `frame-ancestors 'none'` and `X-Frame-Options: DENY`; the single exception is the Teams tab,
// `/teams/tab`, which Microsoft Teams loads in an iframe.
//
// This test reads the real `headers()` of next.config.ts, then WALKS every page.tsx and route.ts
// under src/app, works out each one's URL, finds which header rules apply to that URL using Next's
// own path matcher, and proves every URL except `/teams/tab` is still locked. It fails loudly if
// anyone adds a second framable route — or widens the rule.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
// @ts-expect-error -- Next ships its compiled path matcher without type declarations
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

type Rule = { source: string; headers: { key: string; value: string }[] };

const TAB = "/teams/tab";
const APP_DIR = path.join(process.cwd(), "src", "app");

/* ---------------------------- the route list ---------------------------- */

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name === "page.tsx" || name === "route.ts") found.push(full);
  }
  return found;
}

/** The URL a page.tsx / route.ts answers, with sample values for dynamic segments. */
function urlFor(file: string): string {
  const segments = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment)) // route groups are not in the URL
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment) || /^\[\.\.\..+\]$/.test(segment)) return "a/b";
      if (/^\[.+\]$/.test(segment)) return "sample";
      return segment;
    });
  return `/${segments.join("/")}`;
}

const ROUTES = Array.from(new Set(walk(APP_DIR).map(urlFor))).sort();

/* ------------------------- the real header rules ------------------------ */

async function rules(): Promise<Rule[]> {
  const list = await (nextConfig.headers as () => Promise<Rule[]>)();
  return list;
}

function matches(rule: Rule, url: string): boolean {
  // Next's own matcher (its compiled path-to-regexp) turns a rule's `source` into a RegExp.
  const compiled = pathToRegexp(rule.source) as unknown as RegExp | { regexp: RegExp };
  return ("regexp" in compiled ? compiled.regexp : compiled).test(url);
}

function headerMap(rule: Rule): Map<string, string> {
  return new Map(rule.headers.map((header) => [header.key.toLowerCase(), header.value]));
}

/** What a request for `url` would be answered with: every rule that applies, merged. */
async function headersFor(url: string): Promise<{ applied: Rule[]; map: Map<string, string> }> {
  const applied = (await rules()).filter((rule) => matches(rule, url));
  const map = new Map<string, string>();
  for (const rule of applied) for (const [key, value] of headerMap(rule)) map.set(key, value);
  return { applied, map };
}

function frameAncestors(csp: string): string {
  const directive = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("frame-ancestors"));
  return directive ?? "";
}

function withoutFraming(csp: string): string {
  return csp
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith("frame-ancestors"))
    .join("; ");
}

/* --------------------------------- tests -------------------------------- */

describe("framing permission", () => {
  it("finds the routes (sanity: the walk sees the ones this change is about)", () => {
    expect(ROUTES.length).toBeGreaterThan(40);
    for (const url of [
      "/login",
      "/api/health",
      "/teams/tab",
      "/teams/auth-end",
      "/api/teams/manifest",
      "/api/teams/session",
      "/api/teams/two-factor",
    ]) {
      expect(ROUTES).toContain(url);
    }
  });

  it("has exactly one rule that permits framing, and its source is exactly /teams/tab", async () => {
    const framing = (await rules()).filter((rule) => !frameAncestors(headerMap(rule).get("content-security-policy") ?? "").includes("'none'"));
    expect(framing).toHaveLength(1);
    expect(framing[0].source).toBe(TAB);
  });

  it("makes the general rule exclude only that path", async () => {
    const all = await rules();
    const general = all.find((rule) => rule.source !== TAB);
    expect(general).toBeDefined();
    if (!general) return;
    // Not the tab itself…
    expect(matches(general, TAB)).toBe(false);
    // …but everything next to it, under it, or looking like it.
    for (const url of ["/", "/teams", "/teams/tabs", "/teams/tab/extra", "/teams/tab2", "/teams/auth-end", "/team/tab"]) {
      expect(matches(general, url), url).toBe(true);
    }
    expect(matches(all.find((rule) => rule.source === TAB) as Rule, "/teams/tabs")).toBe(false);
  });

  it("denies framing on EVERY route except /teams/tab", async () => {
    for (const url of ROUTES) {
      const { applied, map } = await headersFor(url);
      if (url === TAB) continue;
      expect(applied, `${url} must be matched by exactly one rule`).toHaveLength(1);
      expect(frameAncestors(map.get("content-security-policy") ?? ""), url).toBe("frame-ancestors 'none'");
      expect(map.get("x-frame-options"), url).toBe("DENY");
    }
  });

  it("lists the named routes explicitly as locked, not merely by the walk", async () => {
    for (const url of ["/teams/auth-end", "/login", "/api/health", "/api/teams/manifest", "/api/teams/session"]) {
      const { map } = await headersFor(url);
      expect(frameAncestors(map.get("content-security-policy") ?? ""), url).toBe("frame-ancestors 'none'");
      expect(map.get("x-frame-options"), url).toBe("DENY");
    }
  });

  it("gives /teams/tab a named list of Teams hosts and no X-Frame-Options", async () => {
    const { applied, map } = await headersFor(TAB);
    expect(applied).toHaveLength(1);
    expect(map.has("x-frame-options")).toBe(false);

    const sources = frameAncestors(map.get("content-security-policy") ?? "")
      .replace("frame-ancestors", "")
      .trim()
      .split(/\s+/);
    expect(sources).toContain("'self'");
    expect(sources).toContain("https://teams.microsoft.com");
    expect(sources).not.toContain("'none'");
  });

  it("never permits a bare *, https: or http: — every entry is 'self' or a named https host", async () => {
    const { map } = await headersFor(TAB);
    const sources = frameAncestors(map.get("content-security-policy") ?? "")
      .replace("frame-ancestors", "")
      .trim()
      .split(/\s+/);
    for (const source of sources) {
      expect(source).not.toBe("*");
      expect(source).not.toBe("https:");
      expect(source).not.toBe("http:");
      expect(source === "'self'" || /^https:\/\/(\*\.)?[a-z0-9.-]+\.[a-z]+$/.test(source), source).toBe(true);
    }
  });

  it("leaves the rest of the policy and every other header identical between the two rules", async () => {
    const tab = headerMap((await rules()).find((rule) => rule.source === TAB) as Rule);
    const general = headerMap((await rules()).find((rule) => rule.source !== TAB) as Rule);

    expect(withoutFraming(tab.get("content-security-policy") ?? "")).toBe(
      withoutFraming(general.get("content-security-policy") ?? ""),
    );
    for (const key of new Set([...tab.keys(), ...general.keys()])) {
      if (key === "content-security-policy" || key === "x-frame-options") continue;
      expect(tab.get(key), key).toBe(general.get(key));
    }
  });
});
