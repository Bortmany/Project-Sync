// /api/health answers two different questions depending on who asks. A monitor (anonymous) only
// needs "are you up?" and only gets { ok }. The detailed body — which integrations are keyed, how
// the sweep is doing, uptime — describes the deployment and is only handed to a signed-in session.

import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");
process.env.SWEEP_DISABLED = "1";

// The route reads the session cookie, which only exists inside a real request; the tests hand it
// an actor (or none) directly, exactly as the Microsoft route tests do.
const session = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/session")>();
  return { ...actual, currentActor: async () => session.actor };
});

import { GET as healthRoute } from "@/app/api/health/route";
import { prisma } from "@/lib/db";
import { makeOrg, resetDatabase } from "@/server/__tests__/harness";
import { AI_TEST_KEY } from "@/server/__tests__/ai-harness";
import {
  TEAMS_TEST_APP_ID,
  TEST_CLIENT_SECRET,
  configureTeamsEnv,
} from "@/server/__tests__/microsoft-signin-fixtures";

describe("GET /api/health", () => {
  afterEach(() => {
    session.actor = null;
    vi.unstubAllEnvs();
  });

  it("tells an anonymous caller only whether the app is up", async () => {
    const response = await healthRoute();
    const body = await response.json();

    expect([200, 503]).toContain(response.status);
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(body.ok).toBe(response.status === 200);
  });

  it("gives the detailed body to a signed-in session", async () => {
    session.actor = { userId: "someone", orgId: "org", role: "ENGINEER" };
    const response = await healthRoute();
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      status: "ok",
      db: "up",
      integrations: { slack: expect.any(Number), teams: expect.any(Number) },
      email: expect.any(String),
      billing: expect.any(String),
    });
    expect(body).toHaveProperty("sentry");
    expect(body).toHaveProperty("microsoft");
    expect(body).toHaveProperty("sweep");
    expect(body).toHaveProperty("uptime");
  });

  it("reports the Teams app as a single word: dormant until set up, configured once it is", async () => {
    session.actor = { userId: "someone", orgId: "org", role: "ENGINEER" };

    const before = await (await healthRoute()).json();
    expect(before.teams_app).toBe("dormant");

    const restore = configureTeamsEnv();
    try {
      const after = await (await healthRoute()).json();
      expect(after.teams_app).toBe("configured");
      // A word and nothing else: no app id, no host, no secret anywhere in the value.
      expect(JSON.stringify(after.teams_app)).toBe('"configured"');
      const text = JSON.stringify(after);
      expect(text).not.toContain(TEAMS_TEST_APP_ID);
      expect(text).not.toContain(TEST_CLIENT_SECRET);
      expect(text).not.toContain("tielora.test");
    } finally {
      restore();
    }
  });

  it("reports Ask Tielora as a single word: dormant without ANTHROPIC_API_KEY, configured with it, never any part of the key", async () => {
    session.actor = { userId: "someone", orgId: "org", role: "ENGINEER" };

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const before = await (await healthRoute()).json();
    expect(before.ai).toBe("dormant");

    vi.stubEnv("ANTHROPIC_API_KEY", AI_TEST_KEY);
    const after = await (await healthRoute()).json();
    expect(after.ai).toBe("configured");
    expect(JSON.stringify(after.ai)).toBe('"configured"');
    expect(JSON.stringify(after)).not.toContain(AI_TEST_KEY);
    expect(JSON.stringify(after)).not.toContain(AI_TEST_KEY.slice(0, 14));
  });

  it("keeps the AI word out of the anonymous answer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", AI_TEST_KEY);
    const body = await (await healthRoute()).json();
    expect(body).not.toHaveProperty("ai");
  });

  it("keeps the Teams app out of the anonymous answer", async () => {
    const body = await (await healthRoute()).json();
    expect(body).not.toHaveProperty("teams_app");
  });

  it("counts the companies with Sign in with Microsoft switched on — a number and nothing else", async () => {
    await resetDatabase();
    const a = await makeOrg("Health Microsoft A");
    await makeOrg("Health Microsoft B");
    const tenant = "0b7c9a52-3f1e-4d2a-9c6b-8e5f4a3d2c1b";
    await prisma.organization.update({ where: { id: a.id }, data: { entraTenantId: tenant } });

    session.actor = { userId: "someone", orgId: a.id, role: "ADMIN" };
    const body = await (await healthRoute()).json();

    expect(body.microsoft.signInOrgs).toBe(1);
    expect(JSON.stringify(body)).not.toContain(tenant);
    await resetDatabase();
  });
});
