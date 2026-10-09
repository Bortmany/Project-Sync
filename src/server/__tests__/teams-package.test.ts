// The Teams package an administrator downloads, and the switch that keeps the whole feature dormant
// until the owner sets it up. No database, no network.

import { describe, expect, it } from "vitest";
import { readZip } from "@/lib/zip";
import { teamsAppConfig, teamsAppStatus, teamsCookieOptions, TEAMS_COOKIE, TEAMS_COOKIE_PATH } from "@/lib/teams-app";
import { TEAMS_ACCENT_COLOR, TEAMS_APP_VERSION, buildTeamsManifest, buildTeamsPackage } from "@/lib/teams-manifest";
import { TEAMS_TEST_APP_ID, TEST_CLIENT_ID, TEST_CLIENT_SECRET } from "@/server/__tests__/microsoft-signin-fixtures";

const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  TEAMS_APP_ID: TEAMS_TEST_APP_ID,
  APP_BASE_URL: "https://tielora.up.railway.app",
  MS_GRAPH_CLIENT_ID: TEST_CLIENT_ID,
  MS_GRAPH_CLIENT_SECRET: TEST_CLIENT_SECRET,
};

function config() {
  const found = teamsAppConfig(ENV);
  if (!found) throw new Error("the test environment should be configured");
  return found;
}

describe("the Teams app is dormant until everything is set", () => {
  it("is configured when all four settings are present", () => {
    expect(teamsAppStatus(ENV)).toBe("configured");
  });

  it("is dormant when any one of them is missing or wrong", () => {
    for (const change of [
      { TEAMS_APP_ID: undefined },
      { TEAMS_APP_ID: "not-a-guid" },
      { APP_BASE_URL: undefined },
      { APP_BASE_URL: "http://tielora.up.railway.app" },
      { MS_GRAPH_CLIENT_ID: undefined },
      { MS_GRAPH_CLIENT_SECRET: undefined },
    ]) {
      expect(teamsAppStatus({ ...ENV, ...change }), JSON.stringify(change)).toBe("dormant");
    }
    expect(teamsAppStatus({} as NodeJS.ProcessEnv)).toBe("dormant");
  });

  it("accepts exactly one audience: the client id, or the one value the owner set", () => {
    expect(config().audience).toBe(TEST_CLIENT_ID);
    const pinned = teamsAppConfig({ ...ENV, TEAMS_SSO_AUDIENCE: `api://tielora.up.railway.app/${TEST_CLIENT_ID}` });
    expect(pinned?.audience).toBe(`api://tielora.up.railway.app/${TEST_CLIENT_ID}`);
  });
});

describe("the manifest", () => {
  it("names this deployment and nothing about any company", () => {
    const manifest = buildTeamsManifest(config());

    expect(manifest.id).toBe(TEAMS_TEST_APP_ID);
    expect(manifest.version).toBe(TEAMS_APP_VERSION);
    expect(manifest.staticTabs).toHaveLength(1);
    expect(manifest.staticTabs[0]).toMatchObject({
      entityId: "your-day",
      name: "Your day",
      contentUrl: "https://tielora.up.railway.app/teams/tab",
      scopes: ["personal"],
    });
    // The deployment's host, and nothing else.
    expect(manifest.validDomains).toEqual(["tielora.up.railway.app"]);
    // The api:// resource matches the client id.
    expect(manifest.webApplicationInfo).toEqual({
      id: TEST_CLIENT_ID,
      resource: `api://tielora.up.railway.app/${TEST_CLIENT_ID}`,
    });
    expect(manifest.accentColor).toBe(TEAMS_ACCENT_COLOR);
  });

  it("uses https addresses only, and holds no secret", () => {
    const text = JSON.stringify(buildTeamsManifest(config()));
    const urls = text.match(/"https?:\/\/[^"]+"/g) ?? [];
    expect(urls.length).toBeGreaterThan(3);
    for (const url of urls) expect(url.startsWith('"https://'), url).toBe(true);
    expect(text).not.toContain(TEST_CLIENT_SECRET);
    expect(text).not.toMatch(/secret/i);
  });

  it("uses the brand's own primary colour", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(`${process.cwd()}/src/app/globals.css`, "utf8");
    expect(css.toLowerCase()).toContain(`--brand-primary: ${TEAMS_ACCENT_COLOR}`);
  });
});

describe("the package", () => {
  it("is a zip of exactly three files, with icons of the sizes Teams requires", async () => {
    const entries = readZip(await buildTeamsPackage(config()));
    expect(entries.map((entry) => entry.name).sort()).toEqual(["color.png", "manifest.json", "outline.png"]);

    const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
    const manifest = JSON.parse((byName.get("manifest.json") as Buffer).toString("utf8"));
    expect(manifest.id).toBe(TEAMS_TEST_APP_ID);

    const size = (data: Buffer) => ({
      signature: data.subarray(0, 8).toString("hex"),
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    });
    expect(size(byName.get("color.png") as Buffer)).toEqual({ signature: "89504e470d0a1a0a", width: 192, height: 192 });
    expect(size(byName.get("outline.png") as Buffer)).toEqual({ signature: "89504e470d0a1a0a", width: 32, height: 32 });
  });
});

describe("the tab's cookie", () => {
  it("is boxed in: partitioned, SameSite=None, Secure, HttpOnly and limited to /teams", () => {
    expect(TEAMS_COOKIE).toBe("tielora_teams");
    expect(TEAMS_COOKIE_PATH).toBe("/teams");
    const options = teamsCookieOptions(new Date(Date.now() + 1000));
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      path: "/teams",
    });
  });
});
