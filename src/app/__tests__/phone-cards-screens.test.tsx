// Phone cards and safe text, drawn: the shared card, the Tasks tab, Admin → Users and the documents
// list each get a stack of cards below 640px (the table is hidden there and the cards are hidden
// from 640px up), and every piece of text a person types wraps instead of widening the page.
// Render tests like ask-tielora-screens.test.tsx: no database, no network, no browser. A page's real
// width can only be measured in a browser, so these check the classes that decide it — and a scan of
// the source fails the moment anyone adds a pre-wrapped text without `break-words`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { DocumentDTO, MainTaskListItemDTO, ProjectDTO, UserDTO } from "@/lib/zod-schemas";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined, push: () => undefined }),
}));

// The Tasks tab reads its rows through a hook; hand it two fixed ones.
const TASKS: MainTaskListItemDTO[] = [];
vi.mock("@/components/hooks/use-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectMainTasks: () => ({
    data: TASKS,
    isPending: false,
    isError: false,
    refetch: () => undefined,
  }),
}));
vi.mock("@/components/projects/phase-rail", () => ({
  PhaseRail: () => null,
  UNPHASED: "unphased",
}));

import { AdminUsersView } from "@/components/admin/admin-users-view";
import { DocumentTable } from "@/components/documents/document-table";
import { CounterLine, CommentComposer } from "@/components/comments/comment-composer";
import { ProjectTasksTab } from "@/components/projects/project-tasks-tab";
import { PhoneCard, PhoneCardList } from "@/components/ui";
import { ToastProvider } from "@/components/ui";

/** React puts comment markers between adjacent text pieces; a person never sees them. */
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

/** Pulls out just the part of the page that is the phone stack, and just the desktop table. */
function phoneStack(html: string): string {
  const start = html.indexOf("sm:hidden");
  return start === -1 ? "" : html.slice(start, html.indexOf("hidden overflow-x-auto"));
}
function desktopTable(html: string): string {
  const start = html.indexOf("hidden overflow-x-auto");
  return start === -1 ? "" : html.slice(start);
}

const LONG = "C:\\drawings\\".concat("A".repeat(3000));
const FUTURE = new Date("2030-05-25T00:00:00Z");
const PAST = new Date("2020-05-25T00:00:00Z");

/* ------------------------------ the shared card ------------------------------ */

describe("PhoneCard", () => {
  it("is shown below 640px only, and wraps a pasted 3,000-character title", () => {
    const html = draw(
      <PhoneCardList label="Things">
        <PhoneCard title={LONG} fields={[{ label: "Status", value: "Open" }]} />
      </PhoneCardList>,
    );
    expect(html).toContain("sm:hidden");
    expect(html).toMatch(/<p class="[^"]*min-w-0[^"]*break-words[^"]*">C:\\drawings/);
    // The card itself may shrink inside its column, so it can never push the page wider.
    expect(html).toMatch(/<li class="min-w-0 /);
    expect(html).toContain("Status");
  });

  it("is one whole-card tap target with a 44px floor when it opens a page", () => {
    const html = draw(
      <PhoneCardList label="Things">
        <PhoneCard href="/tasks/t1" title="Pump" fields={[]} />
      </PhoneCardList>,
    );
    expect(html).toContain('href="/tasks/t1"');
    expect(html).toContain("min-h-11");
  });

  it("leaves out a line that has nothing to say instead of drawing a dash", () => {
    const html = draw(
      <PhoneCardList label="Things">
        <PhoneCard
          title="Pump"
          fields={[
            { label: "Company", value: "x", hidden: true },
            { label: "Role", value: "Engineer" },
          ]}
        />
      </PhoneCardList>,
    );
    expect(html).not.toContain("Company");
    expect(html).toContain("Role");
  });
});

/* ------------------------------ Tasks tab ------------------------------ */

function task(over: Partial<MainTaskListItemDTO>): MainTaskListItemDTO {
  return {
    id: "t1",
    projectId: "p1",
    projectCode: "SUR-EXP",
    phaseId: null,
    title: "Install the surge vessel",
    priority: "HIGH",
    deadline: FUTURE,
    effectiveStatus: "IN_PROGRESS",
    hasOverride: false,
    progressPct: 40,
    isOverdue: false,
    counts: { disciplineTasks: 5, completed: 2 },
    disciplineSummary: [],
    ...over,
  };
}

const PROJECT = { id: "p1", disciplines: [], members: [] } as unknown as ProjectDTO;

describe("the project Tasks tab on a phone", () => {
  it("gives each task a card with its deadline (with the year), status and priority, tappable through to the task", () => {
    TASKS.length = 0;
    TASKS.push(
      task({}),
      task({ id: "t2", title: LONG, isOverdue: true, deadline: PAST, effectiveStatus: "BLOCKED", priority: "CRITICAL" }),
    );
    const html = draw(<ProjectTasksTab project={PROJECT} canManage={false} />);
    const phone = phoneStack(html);

    expect(phone).toContain('href="/tasks/t1"');
    for (const label of ["Deadline", "Status", "Priority", "Progress"]) expect(phone).toContain(label);
    expect(phone).toContain("25 May 2030");
    expect(phone).toContain("In progress");
    expect(phone).toContain("High");
    // Late work says so on the card itself, in the blocked red.
    expect(phone).toContain("25 May 2020 · overdue");
    expect(phone).toContain("var(--status-blocked)");
    // A pasted path wraps.
    expect(phone).toMatch(/break-words[^>]*>C:\\drawings/);
  });

  it("keeps the table for 640px and up, with its titles wrapped inside the cell", () => {
    TASKS.length = 0;
    TASKS.push(task({ title: LONG }));
    const html = draw(<ProjectTasksTab project={PROJECT} canManage={false} />);
    const table = desktopTable(html);
    expect(table).toContain("<table");
    expect(table).toContain("sm:block");
    expect(table).toMatch(/max-w-md[^"]*break-words/);
  });
});

/* ------------------------------ Admin → Users ------------------------------ */

function person(over: Partial<UserDTO>): UserDTO {
  return {
    id: "u1",
    email: "fatima@example.com",
    name: "Fatima Al Balushi",
    role: "ENGINEER",
    disciplineId: null,
    jobTitle: null,
    companyName: null,
    isActive: true,
    lastLoginAt: null,
    accessExpiresAt: null,
    twoFactorEnabled: false,
    createdAt: PAST,
    ...over,
  };
}

describe("Admin → Users on a phone", () => {
  const users = [
    person({}),
    person({
      id: "u2",
      email: "ali@contractor.example",
      name: "Ali Contractor",
      role: "EXTERNAL",
      companyName: "Gulf Pipes",
      accessExpiresAt: PAST,
    }),
    person({ id: "u3", name: "Sana Gone", isActive: false }),
  ];

  it("shows Role, Access and Status with Edit, Deactivate and Extend as full-width 44px buttons", () => {
    const html = draw(<AdminUsersView users={users} disciplines={[]} />);
    const phone = phoneStack(html);

    for (const label of ["Role", "Access", "Status", "Email"]) expect(phone).toContain(label);
    expect(phone).toContain("Fatima Al Balushi");
    // The contractor's access has run out, and the card says so and offers the way back.
    expect(phone).toContain("Expired");
    expect(phone).toContain("Extend access");
    expect(phone).toContain("Deactivate");
    expect(phone).toContain("Reactivate");
    expect(phone).toContain("Edit");
    expect(phone).toMatch(/<button[^>]*min-h-11 w-full[^>]*>Edit<\/button>/);
    // A person who is switched off is dimmed, as on the table.
    expect(phone).toContain("opacity-60");
  });

  it("keeps the table from 640px up, unchanged in what it lists", () => {
    const table = desktopTable(draw(<AdminUsersView users={users} disciplines={[]} />));
    for (const heading of ["Name", "Email", "Role", "Access ends", "Status", "Actions"]) {
      expect(table).toContain(heading);
    }
  });

  it("wraps a very long name and address", () => {
    const html = draw(
      <AdminUsersView users={[person({ name: LONG, email: `${"b".repeat(500)}@example.com` })]} disciplines={[]} />,
    );
    expect(phoneStack(html)).toMatch(/break-words[^>]*>C:\\drawings/);
    expect(desktopTable(html)).toMatch(/max-w-md[^"]*break-words/);
  });
});

/* ------------------------------ Documents ------------------------------ */

function doc(over: Partial<DocumentDTO>): DocumentDTO {
  return {
    id: "d1",
    projectId: "p1",
    mainTaskId: "t1",
    disciplineTaskId: null,
    title: "Pump datasheet",
    category: "Datasheet",
    uploadedById: "u1",
    uploadedByName: "Fatima Al Balushi",
    uploadedByCompanyName: null,
    createdAt: PAST,
    versionsCount: 3,
    currentRevision: {
      id: "v3",
      documentId: "d1",
      revisionNumber: 3,
      originalFilename: "pump.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2 * 1024 * 1024,
      checksumSha256: "abc",
      uploadedById: "u1",
      uploadedByName: "Fatima Al Balushi",
      note: "Corrected flange size",
      createdAt: FUTURE,
      downloadUrl: "/api/documents/versions/v3/download",
    },
    ...over,
  };
}

function table(documents: DocumentDTO[]) {
  return (
    <DocumentTable
      groups={[{ key: "g", label: "Shared", documents }]}
      isPending={false}
      isError={false}
      onRetry={() => undefined}
      canDelete
      empty={<p>None</p>}
    />
  );
}

describe("New revision is only offered to people who may upload", () => {
  function tableFor(canUpload: boolean | undefined) {
    return (
      <DocumentTable
        groups={[{ key: "g", label: "Shared", documents: [doc({})] }]}
        isPending={false}
        isError={false}
        onRetry={() => undefined}
        canDelete
        canUpload={canUpload}
        empty={<p>None</p>}
      />
    );
  }

  it("hides it on the table row and the phone card when canUpload is false", () => {
    const html = draw(tableFor(false));
    expect(phoneStack(html)).not.toContain("New revision");
    expect(desktopTable(html)).not.toContain("New revision");
    // Everything else is still there.
    expect(phoneStack(html)).toContain("History");
    expect(desktopTable(html)).toContain("Download");
  });

  it("shows it on both when canUpload is true or left out", () => {
    for (const flag of [true, undefined]) {
      const html = draw(tableFor(flag));
      expect(phoneStack(html)).toContain("New revision");
      expect(desktopTable(html)).toContain("New revision");
    }
  });

  it("lets a per-document answer override the table-wide one", () => {
    const html = draw(
      <DocumentTable
        groups={[{ key: "g", documents: [doc({})] }]}
        isPending={false}
        isError={false}
        onRetry={() => undefined}
        canDelete
        canUploadFor={() => false}
        empty={<p>None</p>}
      />,
    );
    expect(html).not.toContain("New revision");
  });
});

describe("the documents list on a phone", () => {
  it("shows each document with its revision, size, who filed it and when, and the three buttons full width", () => {
    const html = draw(table([doc({})]));
    const phone = phoneStack(html);

    expect(phone).toContain("Pump datasheet");
    expect(phone).toContain("Rev 3");
    expect(phone).toContain("Latest");
    expect(phone).toContain("Fatima Al Balushi");
    expect(phone).toContain("25 May 2030");
    expect(phone).toContain("2.0 MB");
    expect(phone).toContain("Datasheet");
    expect(phone).toContain('href="/api/documents/versions/v3/download"');
    expect(phone).toContain("Download");
    expect(phone).toContain("History");
    expect(phone).toContain("New revision");
    expect(phone).toMatch(/<button[^>]*min-h-11 w-full[^>]*>History<\/button>/);
  });

  it("tells the same story the table does for the same document", () => {
    const html = draw(table([doc({})]));
    for (const part of [phoneStack(html), desktopTable(html)]) {
      for (const fact of ["Pump datasheet", "Rev 3", "Fatima Al Balushi", "25 May 2030", "2.0 MB", "Download", "History", "New revision"]) {
        expect(part).toContain(fact);
      }
    }
  });

  it("wraps a very long unbroken title on the card and in the table", () => {
    const html = draw(table([doc({ title: LONG })]));
    expect(phoneStack(html)).toMatch(/break-words[^>]*>C:\\drawings/);
    expect(desktopTable(html)).toMatch(/break-words[^>]*>C:\\drawings/);
  });
});

/* ------------------------------ the comment counter ------------------------------ */

describe("the comment box counter", () => {
  it("is quiet for a short comment", () => {
    expect(renderToStaticMarkup(<CounterLine length={120} />)).toBe("");
    expect(renderToStaticMarkup(<CounterLine length={4000} />)).toBe("");
  });

  it("says how many characters are left once past 80% of the limit", () => {
    const html = draw(<CounterLine length={4500} />);
    expect(html).toContain("500 characters left");
    expect(html).toContain('role="status"');
  });

  it("refuses past the limit in plain English and as an alert", () => {
    const html = draw(<CounterLine length={5003} />);
    expect(html).toContain("This comment is 3 characters over the 5,000 limit. Shorten it to post.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("var(--status-blocked)");
  });

  it("draws nothing under an empty box and keeps Post off until there is something to post", () => {
    const html = draw(
      <CommentComposer mentionable={[]} onPosted={() => undefined} mainTaskId="t1" />,
    );
    expect(html).not.toContain("characters left");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Post<\/button>|<button[^>]*>[^<]*Post<\/button>/);
  });
});

/* ------------------------------ the standing check ------------------------------ */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("text people type can never widen a page", () => {
  it("every pre-wrapped text in the app also carries break-words", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("whitespace-pre-wrap")) return;
        // The class list may continue a line or two either side; look at the whole opening tag.
        const around = lines.slice(Math.max(0, index - 1), index + 2).join(" ");
        if (!around.includes("break-words")) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
