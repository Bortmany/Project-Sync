// The Teams app package: a typed manifest built in code (so the host and ids can never be stale),
// zipped with the repo's own tiny writer together with the two icons from public/teams/.
//
// The package is the same for every company — it names no company and holds no secret. The only
// per-deployment facts in it are the app's GUID (`TEAMS_APP_ID`, an identifier, not a secret), the
// deployment's own address and the Azure app's client id (an identifier too).
//
// **Bump `TEAMS_APP_VERSION` whenever anything in the manifest changes**, and re-upload the new zip:
// Teams keeps serving the old manifest until the version moves. A change of `APP_BASE_URL` counts.

import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipWriter } from "@/lib/zip";
import type { TeamsAppConfig } from "@/lib/teams-app";

/** The package's own version (not the schema's). Bump on any manifest change. */
export const TEAMS_APP_VERSION = "1.0.0";

/**
 * The manifest schema this file is written for. A personal tab with single sign-on works from 1.5
 * onward and 1.17 is long-standing and still accepted by the Teams Developer Portal; newer schemas
 * add nothing this app needs. Re-validate in the portal (Apps -> Import app) on compare day.
 */
export const TEAMS_MANIFEST_SCHEMA_VERSION = "1.17";

/**
 * Teams' accent colour for the app. This is `--brand-primary` from src/app/globals.css, copied here
 * ONCE because a manifest is JSON and cannot read a stylesheet (house rule 7: not a new colour).
 */
export const TEAMS_ACCENT_COLOR = "#2e5aac";

/** The two files read from public/teams/ and their entries in the zip. */
export const TEAMS_ICON_FILES = { color: "color.png", outline: "outline.png" } as const;

export type TeamsManifest = ReturnType<typeof buildTeamsManifest>;

/** The manifest for this deployment. Pure: same config in, same JSON out. */
export function buildTeamsManifest(config: TeamsAppConfig) {
  return {
    $schema: `https://developer.microsoft.com/json-schemas/teams/v${TEAMS_MANIFEST_SCHEMA_VERSION}/MicrosoftTeams.schema.json`,
    manifestVersion: TEAMS_MANIFEST_SCHEMA_VERSION,
    version: TEAMS_APP_VERSION,
    id: config.appId,
    developer: {
      name: "Tielora",
      websiteUrl: config.baseUrl,
      privacyUrl: `${config.baseUrl}/privacy`,
      termsOfUseUrl: `${config.baseUrl}/terms`,
    },
    name: { short: "Tielora", full: "Tielora - your day in Teams" },
    description: {
      short: "See what needs you today, right inside Teams.",
      full: "Tielora brings your day into Teams: the work due today, what is overdue, what has just been unblocked, your mentions and what is waiting for your review. It is read only - every item opens in Tielora in your browser, where you do the work.",
    },
    icons: { color: TEAMS_ICON_FILES.color, outline: TEAMS_ICON_FILES.outline },
    accentColor: TEAMS_ACCENT_COLOR,
    staticTabs: [
      {
        entityId: "your-day",
        name: "Your day",
        contentUrl: `${config.baseUrl}/teams/tab`,
        websiteUrl: `${config.baseUrl}/my-tasks/brief`,
        scopes: ["personal"],
      },
    ],
    permissions: ["identity"],
    // This deployment's host and nothing else.
    validDomains: [config.host],
    webApplicationInfo: { id: config.clientId, resource: config.resource },
  };
}

/** Where the two icons live. Relative to the running app's folder, like every other public file. */
export function teamsIconDir(): string {
  return path.join(process.cwd(), "public", "teams");
}

/**
 * The zip an administrator downloads: exactly three files — `manifest.json`, `color.png`,
 * `outline.png`. Built with the repo's own ZipWriter (which writes to a file), through a throwaway
 * file in the temp folder that is removed straight afterwards.
 */
export async function buildTeamsPackage(config: TeamsAppConfig): Promise<Buffer> {
  const [color, outline] = await Promise.all([
    readFile(path.join(teamsIconDir(), TEAMS_ICON_FILES.color)),
    readFile(path.join(teamsIconDir(), TEAMS_ICON_FILES.outline)),
  ]);

  const tmp = path.join(os.tmpdir(), `tielora-teams-${randomBytes(12).toString("hex")}.zip`);
  const zip = new ZipWriter(tmp);
  try {
    await zip.addBuffer("manifest.json", Buffer.from(`${JSON.stringify(buildTeamsManifest(config), null, 2)}\n`, "utf8"));
    await zip.addBuffer(TEAMS_ICON_FILES.color, color);
    await zip.addBuffer(TEAMS_ICON_FILES.outline, outline);
    await zip.finish();
    return await readFile(tmp);
  } catch (error) {
    await zip.abort().catch(() => undefined);
    throw error;
  } finally {
    await rm(tmp, { force: true });
  }
}
