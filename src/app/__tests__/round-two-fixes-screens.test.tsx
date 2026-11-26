// November 2026 browser-test fixes, drawn. Render tests like phone-cards-screens.test.tsx: no
// database, no network, no browser — they check the markup that decides what a person sees.
//
//  - Phase cards: the phase name owns the card's whole width and wraps; the manage buttons sit on a
//    row of their own, so they can never squeeze the name to nothing on a laptop.
//  - Admin → Users: a contractor's Discipline box says it is required (it used to say "Not needed"),
//    and `?edit=<id>` opens that person's Edit dialog — the Team tab's shortcut lands there.
//  - Task details read "Due 31 Jan 2027" when there is no start date, never "— — 31 Jan 2027".
//  - Messages: "Everyone in the company is notified", never "Everyone in Everyone".
//  - New project → people: an administrator gets the "Set …'s discipline" link (in a new tab, so the
//    half-filled form survives); the role box is wide enough for "External contractor"; and the
//    project header's dates read sensibly with none, one or both set.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PhaseDTO, UserDTO } from "@/lib/zod-schemas";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined, push: () => undefined }),
}));

const PHASES: PhaseDTO[] = [];
vi.mock("@/components/hooks/use-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePhases: () => ({ data: PHASES, isPending: false, isError: false, refetch: () => undefined }),
}));

import { AdminUsersView } from "@/components/admin/admin-users-view";
import { formatDateRange } from "@/components/format";
import { audienceWords } from "@/components/posts/messages-view";
import { ContractorRowHint } from "@/components/projects/new-project-dialog";
import { PhaseRail } from "@/components/projects/phase-rail";
import { ToastProvider } from "@/components/ui";
import { disciplineHint, disciplineProblem } from "@/lib/discipline-rules";

function plain(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

function draw(node: ReactNode): string {
  const client = new QueryClient();
  return plain(
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>{node}</ToastProvider>
      </QueryClientProvider>,
    ),
  );
}

function phase(index: number, name: string, over: Partial<PhaseDTO> = {}): PhaseDTO {
  return {
    id: `p${index}`,
    projectId: "proj",
    name,
    sortOrder: index,
    locked: index > 0,
    lockedByPhaseName: index > 0 ? "FEED" : null,
    overridden: false,
    overrideReason: null,
    overriddenByName: null,
    overriddenAt: null,
    taskCount: 3,
    completedCount: 1,
    ...over,
  };
}

function setPhases(names: string[]): void {
  PHASES.splice(0, PHASES.length, ...names.map((name, index) => phase(index, name)));
}

const LONG_NAME = "Detailed engineering design and procurement of long-lead equipment";

/** Each phase card's own markup, in order. */
function cards(html: string): string[] {
  return html.split("<li ").slice(1);
}

describe("phase cards keep the phase name readable for people who manage them", () => {
  for (const count of [5, 9]) {
    it(`shows every one of ${count} names in full, untruncated, with the buttons on their own row`, () => {
      const names = ["FEED", "Detail design", LONG_NAME, "Construction", "Commissioning"];
      while (names.length < count) names.push(`Extra phase ${names.length + 1}`);
      setPhases(names);

      const html = draw(
        <PhaseRail projectId="proj" canManage unphasedCount={0} selected={null} onSelect={() => undefined} />,
      );
      const drawn = cards(html);
      expect(drawn).toHaveLength(count);

      drawn.forEach((card, index) => {
        // The name is drawn whole, in a box that wraps rather than clips.
        const name = card.match(/<span data-phase-name="[^"]*" class="([^"]*)">([^<]*)<\/span>/);
        expect(name?.[2]).toBe(names[index]);
        expect(name?.[1]).toContain("break-words");
        expect(name?.[1]).not.toContain("truncate");

        // Rename, the arrows and delete come AFTER the name and its progress bar, in their own row.
        const actions = card.indexOf("data-phase-actions");
        expect(actions).toBeGreaterThan(card.indexOf("data-phase-name"));
        expect(actions).toBeGreaterThan(card.indexOf('role="progressbar"') === -1 ? 0 : card.indexOf('role="progressbar"'));
        const row = card.slice(actions);
        for (const label of [`Rename ${names[index]}`, `Move ${names[index]} earlier`, `Move ${names[index]} later`, `Delete ${names[index]}`]) {
          expect(row).toContain(`aria-label="${label}"`);
        }
        // Still 44px tap targets.
        expect(row.match(/min-h-11 min-w-11/g)?.length).toBe(4);
      });
    });
  }

  it("draws no manage row at all for people who cannot manage, and the names the same way", () => {
    setPhases(["FEED", LONG_NAME]);
    const html = draw(
      <PhaseRail projectId="proj" canManage={false} unphasedCount={0} selected={null} onSelect={() => undefined} />,
    );
    expect(html).not.toContain("data-phase-actions");
    expect(html).toContain(`>${LONG_NAME}</span>`);
  });
});

function person(over: Partial<UserDTO>): UserDTO {
  return {
    id: "u1",
    email: "sami@partner.example",
    name: "Sami al-Harthy",
    role: "EXTERNAL",
    disciplineId: null,
    jobTitle: null,
    companyName: "Gulf Inspection Services",
    isActive: true,
    lastLoginAt: null,
    accessExpiresAt: null,
    twoFactorEnabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("a contractor's discipline, on Admin → Users", () => {
  const disciplines = [{ id: "d1", code: "MECH", name: "Mechanical", colorHex: "#1F4E79", sortOrder: 1 }];

  it("says a contractor needs one, and never 'Not needed for this role'", () => {
    expect(disciplineHint("EXTERNAL")).toMatch(/Required for contractors/);
    expect(disciplineHint("EXTERNAL")).not.toMatch(/Not needed/);
    expect(disciplineHint("ADMIN")).toBe("Not needed for this role.");
    expect(disciplineProblem("EXTERNAL", null)).toMatch(/Choose the contractor's discipline/);
    expect(disciplineProblem("EXTERNAL", "d1")).toBeNull();
    // A contractor saved before the rule may be saved as they are.
    expect(disciplineProblem("EXTERNAL", null, { role: "EXTERNAL", disciplineId: null })).toBeNull();
    // But nobody newly becomes a contractor without one, and nobody's is cleared.
    expect(disciplineProblem("EXTERNAL", null, { role: "ENGINEER", disciplineId: "d1" })).not.toBeNull();
    expect(disciplineProblem("EXTERNAL", null, { role: "EXTERNAL", disciplineId: "d1" })).not.toBeNull();
  });

  it("opens the Edit dialog for ?edit=<id>, with the discipline hint a legacy contractor needs", () => {
    const html = draw(
      <AdminUsersView users={[person({})]} disciplines={disciplines} editUserId="u1" currentUserId="admin" />,
    );
    expect(html).toContain('aria-label="Edit Sami al-Harthy"');
    expect(html).toContain("Needed before they can join a project. Choose one now.");
    expect(html).not.toContain("Not needed for this role.");
  });

  it("opens nothing for an id that is not in this company's list", () => {
    const html = draw(
      <AdminUsersView users={[person({})]} disciplines={disciplines} editUserId="someone-else" />,
    );
    expect(html).not.toContain('role="dialog"');
  });
});

describe("dates and audiences read as sentences", () => {
  it("says 'Due …' when a task has no start date, and the range when it has one", () => {
    const deadline = new Date(2027, 0, 31);
    expect(formatDateRange(null, deadline)).toBe("Due 31 Jan 2027");
    expect(formatDateRange(undefined, deadline)).toBe("Due 31 Jan 2027");
    expect(formatDateRange(new Date(2027, 0, 1), deadline)).toBe("1 Jan 2027 — 31 Jan 2027");
    expect(formatDateRange(null, deadline)).not.toContain("—");
  });

  it("never says 'Everyone in Everyone'", () => {
    expect(audienceWords({ kind: "EVERYONE", label: "Everyone" })).toBe("Everyone in the company");
    expect(audienceWords({ kind: "PROJECT", label: "PH-1" })).toBe("Everyone on PH-1");
    expect(audienceWords({ kind: "DISCIPLINE", label: "Electrical" })).toBe("Everyone in Electrical");
  });
});

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("new project → people step, for a contractor with no discipline", () => {
  const contractor = { id: "u/42", name: "Salim Al Harthy" };

  it("offers an administrator the same shortcut the Team tab does, in a new tab", () => {
    const html = draw(
      <ContractorRowHint problem="This contractor has no discipline." contractor={contractor} showSetLink />,
    );
    expect(html).toContain("This contractor has no discipline.");
    expect(html).toContain('href="/admin/users?edit=u%2F42"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Set Salim Al Harthy&#x27;s discipline");
    expect(html).toContain("this form stays as it is");
  });

  it("gives everyone else the plain hint and no link", () => {
    const html = draw(
      <ContractorRowHint
        problem="An administrator sets one before they can join a project."
        contractor={contractor}
        showSetLink={false}
      />,
    );
    expect(html).toContain("An administrator sets one");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("/admin/users");
  });

  it("only shows the link to an administrator, and only for a missing discipline", () => {
    const dialog = source("src/components/projects/new-project-dialog.tsx");
    expect(dialog).toContain('const isAdmin = me?.role === "ADMIN";');
    expect(dialog).toContain("showSetLink={isAdmin && !row.user.disciplineId}");
  });

  it("gives the role box room for 'External contractor' instead of a fixed narrow width", () => {
    const dialog = source("src/components/projects/new-project-dialog.tsx");
    // The person (with their remove button) has the whole first line; role and discipline share
    // the second line equally.
    expect(dialog).toContain('className="grid gap-2 sm:grid-cols-2"');
    expect(dialog).toContain('<div className="flex items-center gap-2 sm:col-span-2">');
    expect(dialog).not.toContain('className="w-44"');
  });
});

describe("the project header's dates", () => {
  it("reads sensibly with no dates, a start only, an end only, or both", () => {
    const start = new Date(2027, 0, 1);
    const end = new Date(2027, 0, 31);
    expect(formatDateRange(start, end)).toBe("1 Jan 2027 — 31 Jan 2027");
    expect(formatDateRange(null, end)).toBe("Due 31 Jan 2027");
    expect(formatDateRange(start, null)).toBe("Starts 1 Jan 2027");
    expect(formatDateRange(null, null)).toBe("No dates set");
    expect(formatDateRange(undefined, undefined)).toBe("No dates set");
    for (const line of [
      formatDateRange(null, end),
      formatDateRange(start, null),
      formatDateRange(null, null),
    ]) {
      expect(line).not.toContain("—");
    }
  });

  it("uses that formatter on the project header, never a bare dash between two dates", () => {
    const view = source("src/components/projects/project-view.tsx");
    expect(view).toContain("formatDateRange(data.startDate, data.targetDate)");
    expect(view).not.toMatch(/formatDate\(data\.startDate\)\s*\}?\s*—/);
  });
});
