// Which nav groups the person has closed by hand.
//
// This is the app's only use of web storage, and it is deliberately sessionStorage: whether the
// "My tasks" drop-down is folded away is throwaway interface state for this browser tab, not a
// saved preference and not personal data — a new tab starts fresh with the sensible defaults.
// Every read and write is wrapped, because storage can be switched off or full and a folded menu
// is never worth an exception.

const KEY = "nexus.nav.closed";

export function readClosedGroups(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeClosedGroups(hrefs: string[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(hrefs));
  } catch {
    // Storage unavailable — the menu still works, it just forgets between page loads.
  }
}
