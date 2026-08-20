// A sweep over the source itself, not over one scenario.
//
// Two whole-app promises are easy to keep today and easy to break with the next file somebody adds:
//
//  1. Every mutation is rate limited (house rule 10). A server action does it through
//     beginMutation(); a route handler that changes something does it with limit(byUser…) or,
//     for anonymous traffic, limit(byIp…). A new mutation that forgets fails this test.
//  2. DocumentVersion and ActivityLog rows are append-only (the golden rule). No shipped code path
//     may update or delete one — this reads every source file and says so.
//
// Reading the source is deliberate: a scenario test can only prove the mutations it happens to call,
// and the thing worth proving here is that there is no exception anywhere.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

/** Every .ts/.tsx file under a folder, ignoring the generated Prisma client and the tests themselves. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "generated" || entry === "__tests__" || entry === "node_modules") continue;
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
    }
  };
  walk(root);
  return found;
}

const relative = (file: string): string => path.relative(process.cwd(), file);
const read = (file: string): string => readFileSync(file, "utf8");

/* ------------------------------------------------------------------ */
/* 1. Every mutation is rate limited                                   */
/* ------------------------------------------------------------------ */

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** The route handlers that change something, as `path → the methods it exports`. */
function mutatingRouteHandlers(): { file: string; method: string; source: string }[] {
  const routes = sourceFiles(path.join(SRC, "app", "api")).filter((file) =>
    file.endsWith(`${path.sep}route.ts`),
  );
  const handlers: { file: string; method: string; source: string }[] = [];
  for (const file of routes) {
    const source = read(file);
    for (const method of MUTATING_METHODS) {
      const exported = new RegExp(`export\\s+(async\\s+)?(function\\s+${method}\\b|const\\s+${method}\\b)`);
      if (exported.test(source)) handlers.push({ file, method, source });
    }
  }
  return handlers;
}

/** The exported server actions, each with the body between its signature and the next export. */
function serverActions(): { file: string; name: string; body: string }[] {
  const files = sourceFiles(path.join(SRC, "server", "actions")).filter(
    (file) => !file.endsWith("guard.ts"),
  );

  const actions: { file: string; name: string; body: string }[] = [];
  for (const file of files) {
    const source = read(file);
    const signature = /export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
    const starts: { name: string; at: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = signature.exec(source)) !== null) {
      starts.push({ name: match[1], at: match.index });
    }
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1].at : source.length;
      actions.push({ file, name: start.name, body: source.slice(start.at, end) });
    });
  }
  return actions;
}

/** True when this piece of source asks the rate limiter for permission. */
function isRateLimited(source: string): boolean {
  return (
    /\bbeginMutation\s*\(/.test(source) ||
    /\blimit\s*\(\s*by(User|Ip)\s*\(/.test(source) ||
    /\bcheckOnly\s*\(/.test(source)
  );
}

/**
 * Gaps this milestone found but is not allowed to fix (test hardening owns tests only).
 * Each one has a test.todo below describing it. Anything NOT on this list must be limited.
 */
const KNOWN_GAPS: string[] = [];

describe("every mutation is rate limited", () => {
  it("finds the mutating route handlers and the server actions, so the sweep is not vacuous", () => {
    // If a refactor moves these files, this test tells us before the sweep starts passing by accident.
    expect(mutatingRouteHandlers().length).toBeGreaterThan(0);
    expect(serverActions().length).toBeGreaterThan(10);
  });

  it("rate limits every route handler that changes something", () => {
    const unguarded = mutatingRouteHandlers()
      .filter((handler) => !isRateLimited(handler.source))
      .map((handler) => `${relative(handler.file)} (${handler.method})`)
      .filter((name) => !KNOWN_GAPS.includes(name));

    expect(unguarded).toEqual([]);
  });

  it("rate limits signing out", () => {
    const source = read(path.join(SRC, "app", "api", "auth", "logout", "route.ts"));
    expect(isRateLimited(source)).toBe(true);
  });

  it("rate limits every server action", () => {
    const unguarded = serverActions()
      .filter((action) => !isRateLimited(action.body))
      .map((action) => `${relative(action.file)} → ${action.name}`);

    expect(unguarded).toEqual([]);
  });

  it("names a rate-limit scope for each server action, so one action cannot spend another's budget", () => {
    const missingScope = serverActions()
      .filter((action) => !/beginMutation\s*\(\s*["'`][a-z0-9-]+["'`]/.test(action.body))
      .map((action) => `${relative(action.file)} → ${action.name}`);

    expect(missingScope).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. DocumentVersion and ActivityLog are append-only                  */
/* ------------------------------------------------------------------ */

/** Prisma writes that change or remove an existing row. `create`/`createMany` are the only legal ones. */
const DESTRUCTIVE_PRISMA = ["update", "updateMany", "delete", "deleteMany", "upsert"];

/** Raw SQL that would rewrite history. */
const DESTRUCTIVE_SQL = (table: string): RegExp[] => [
  new RegExp(`UPDATE\\s+"?${table}"?`, "i"),
  new RegExp(`DELETE\\s+FROM\\s+"?${table}"?`, "i"),
  new RegExp(`TRUNCATE[^;\`]*"?${table}"?`, "i"),
];

function offendingLines(model: string, table: string): string[] {
  const offences: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = read(file).split("\n");
    lines.forEach((line, index) => {
      const where = `${relative(file)}:${index + 1}`;
      for (const verb of DESTRUCTIVE_PRISMA) {
        if (new RegExp(`\\.${model}\\.${verb}\\b`).test(line)) offences.push(`${where} — ${line.trim()}`);
      }
      for (const pattern of DESTRUCTIVE_SQL(table)) {
        if (pattern.test(line)) offences.push(`${where} — ${line.trim()}`);
      }
    });
  }
  return offences;
}

describe("nothing in the app rewrites history", () => {
  it("never updates or deletes a DocumentVersion row", () => {
    expect(offendingLines("documentVersion", "DocumentVersion")).toEqual([]);
  });

  it("never updates or deletes an ActivityLog row", () => {
    expect(offendingLines("activityLog", "ActivityLog")).toEqual([]);
  });

  it("still writes them — the check above is not passing because the models went away", () => {
    const everything = sourceFiles(SRC).map(read).join("\n");
    expect(/\.documentVersion\.create\b/.test(everything)).toBe(true);
    expect(/\.activityLog\.create\b/.test(everything)).toBe(true);
  });

  it("keeps documents soft-deleted rather than removed, so their revisions stay reachable", () => {
    const documents = read(path.join(SRC, "server", "services", "documents.ts"));
    expect(/\.document\.delete\b/.test(documents)).toBe(false);
    // [^)] already spans newlines, so no dotAll flag is needed (and the build target has none).
    expect(/document\.update\([^)]*deletedAt/.test(documents)).toBe(true);
  });
});
