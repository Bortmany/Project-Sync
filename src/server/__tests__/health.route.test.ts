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

describe("GET /api/health", () => {
  afterEach(() => {
    session.actor = null;
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
});
