// The Teams tab's bridge to Microsoft Teams: `@microsoft/teams-js`, bundled from npm (never a CDN —
// the Content-Security-Policy would block one, and a script from elsewhere is not something this
// app loads). Imported lazily, inside an effect or a click, so the server render never touches it.
//
// Nothing here stores anything and nothing here can change data.

"use client";

/** How long to wait for Teams to answer before deciding we are not inside Teams at all. */
const INIT_TIMEOUT_MS = 4_000;

type TeamsJs = typeof import("@microsoft/teams-js");

let loaded: Promise<TeamsJs | null> | null = null;

/** Starts the Teams library once. Null when this page is not running inside Teams. */
export function loadTeams(): Promise<TeamsJs | null> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const teams = await import("@microsoft/teams-js");
        await Promise.race([
          teams.app.initialize(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), INIT_TIMEOUT_MS)),
        ]);
        try {
          // Tells Teams the tab has loaded. Not every frame (the sign-in window) allows it, and
          // failing to say so must never stop the rest from working.
          teams.app.notifyAppLoaded();
          teams.app.notifySuccess();
        } catch {
          // ignore
        }
        return teams;
      } catch {
        return null;
      }
    })();
  }
  return loaded;
}

/**
 * Opens an address in the person's own browser (Teams' "open link"). Outside Teams, or if Teams
 * refuses, it falls back to an ordinary new window. Every link in the tab goes through here: the tab
 * itself never navigates, so nothing can be changed from it.
 */
export async function openInBrowser(href: string): Promise<void> {
  const absolute = new URL(href, window.location.origin).toString();
  const teams = await loadTeams();
  try {
    if (teams) {
      await teams.app.openLink(absolute);
      return;
    }
  } catch {
    // fall through to a plain window
  }
  window.open(absolute, "_blank", "noopener,noreferrer");
}
