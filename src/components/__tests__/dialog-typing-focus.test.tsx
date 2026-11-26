// @vitest-environment jsdom
//
// Typing in a dialog keeps the cursor in the box, and closing a dialog hands focus back to the
// button that opened it (November 2026 browser-test faults).
//
// Fault 1: in New project, typing "Pipeline" one key at a time left only "P" — after the first
// letter the cursor jumped out of the box onto the dialog itself. The same happened in the
// contractor sign-off "Send back" note. Pasting worked, because a paste is one change, not eight.
// The cause: the shared Modal moved focus onto the dialog inside an effect that also listed the
// close handler, and most dialogs hand in a fresh close handler on every render, so every keystroke
// re-ran it. The fix keeps the latest handler in a ref and takes focus only when the dialog opens.
//
// Fault 2: after Escape or Cancel, focus landed at the top of the page instead of on the button
// that opened the dialog, so a keyboard user had to tab all the way back. The Modal and the version
// history slide-over now remember the opener when they open and return focus to it when they close.
//
// These tests render the REAL dialogs in a simulated browser (jsdom — this file only; the rest of
// the suite still runs in plain Node) and type with user-event, one key at a time, checking after
// every key that the whole text is there and the cursor never left the box.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/components/hooks/use-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // One discipline, so New project's step 2 can be passed on the way to the people step.
  useDisciplines: () => ({
    data: [{ id: "d-mech", code: "MECH", name: "Mechanical", colorHex: "#1F6FEB", sortOrder: 1 }],
    isPending: false,
    isError: false,
    refetch: () => undefined,
  }),
  useDocumentVersions: () => ({ data: [], isPending: false, isError: false, refetch: () => undefined }),
  usePhases: () => ({ data: [], isPending: false, isError: false, refetch: () => undefined }),
  // The people search inside New project asks for matches as you type; two are enough here.
  useUsers: () => ({
    data: [
      { id: "u-2", name: "Salma Al Harthy", email: "salma@example.com", role: "ENGINEER", disciplineId: null },
      { id: "u-3", name: "Hamed Al Busaidi", email: "hamed@example.com", role: "ENGINEER", disciplineId: null },
    ],
    isPending: false,
    isError: false,
    refetch: () => undefined,
  }),
}));

// The server actions are never reached from a browser test; the two the sign-off panel calls are
// stand-ins whose answer each test chooses.
const actions = vi.hoisted(() => ({
  rejectDisciplineTaskReview: vi.fn(),
  confirmDisciplineTaskReview: vi.fn(),
  // Reached only by a Save, Apply or Delete press — only the delete-focus test below presses one.
  deleteComment: vi.fn(),
  editComment: vi.fn(),
  editPost: vi.fn(),
  deletePost: vi.fn(),
  updateProject: vi.fn(),
  setExternalSignoffRequired: vi.fn(),
  updateMainTask: vi.fn(),
  setMainTaskPhase: vi.fn(),
  overrideMainTaskStatus: vi.fn(),
  clearOverride: vi.fn(),
  createDisciplineTask: vi.fn(),
  createProject: vi.fn(),
  createDiscipline: vi.fn(),
  updateDiscipline: vi.fn(),
  // The Team tab: only the member-removal and "already on this project" tests below press one.
  addMember: vi.fn(),
  removeMember: vi.fn(),
  removeProjectDiscipline: vi.fn(),
  upsertMember: vi.fn(),
  upsertProjectDiscipline: vi.fn(),
  // Admin → Integrations: only the Slack removal test below presses one.
  deleteIntegration: vi.fn(),
  saveIntegration: vi.fn(),
  sendTestMessage: vi.fn(),
  setEventToggles: vi.fn(),
  setIntegrationEnabled: vi.fn(),
  setBroadcastPolicy: vi.fn(),
}));
vi.mock("@/components/actions", () => actions);

import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { EditProjectDialog } from "@/components/projects/project-view";
import {
  AddDisciplineTaskDialog,
  EditDetailsDialog,
  OverrideDialog,
} from "@/components/tasks/main-task-view";
import { CommentRow } from "@/components/comments/comment-list";
import { PostMenu } from "@/components/posts/messages-view";
import type { CommentRowDTO, MeDTO } from "@/components/hooks/use-api";
import type { MainTaskDTO, PostDTO, ProjectDTO } from "@/lib/zod-schemas";
import { SignOffPanel } from "@/components/tasks/discipline-task-view";
import { VersionHistoryPanel } from "@/components/documents/version-history-panel";
import {
  ErrorBanner,
  Field,
  Input,
  Modal,
  OneTimeCodeInput,
  ToastProvider,
  cleanOneTimeCode,
  type FocusAfterClose,
} from "@/components/ui";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { AdminDisciplinesView } from "@/components/admin/admin-disciplines-view";
import { ProjectTeamTab } from "@/components/projects/project-team-tab";
import { AdminIntegrationsView } from "@/components/admin/admin-integrations-view";
import type { OrgIntegrationDTO } from "@/lib/zod-schemas";

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

/** A page with a button that opens the New project dialog, the way the projects page does. */
function NewProjectPage({ me }: { me?: MeDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a href="#top">Top of the page</a>
      <button type="button" onClick={() => setOpen(true)}>
        + New project
      </button>
      <NewProjectDialog open={open} onClose={() => setOpen(false)} me={me} />
    </>
  );
}

function HistoryPage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Version history
      </button>
      <VersionHistoryPanel
        documentId="doc-1"
        documentTitle="P&ID"
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/**
 * Types `text` into `box` one key at a time — a separate key press per character, exactly as a
 * person does — and checks after EVERY key that all of it so far is in the box and the cursor is
 * still there. `fill`-style one-shot typing hides fault 1, so it is never used here.
 */
async function typeKeyByKey(user: UserEvent, box: HTMLInputElement | HTMLTextAreaElement, text: string) {
  let sofar = box.value;
  for (const key of text) {
    await user.keyboard(key === " " ? " " : key);
    sofar += key;
    expect(box.value).toBe(sofar);
    expect(document.activeElement).toBe(box);
  }
}

/**
 * jsdom ignores `inert`, so a focus move made while a dialog still holds the page "works" here and
 * hides the fault a browser shows (round eight: after deleting a comment, focus landed at the top of
 * the page). A real browser refuses focus inside an inert element; this makes jsdom do the same.
 */
function refuseFocusInsideInert() {
  const original = HTMLElement.prototype.focus;
  beforeEach(() => {
    HTMLElement.prototype.focus = function focus(this: HTMLElement, options?: FocusOptions) {
      if (this.closest("[inert]")) return;
      original.call(this, options);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.focus = original;
  });
}

let user: UserEvent;

beforeEach(() => {
  user = userEvent.setup();
  actions.rejectDisciplineTaskReview.mockReset();
  actions.confirmDisciplineTaskReview.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("New project: typing one key at a time", () => {
  it("keeps every letter of the name and code, and the cursor never leaves the box", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));

    const dialog = screen.getByRole("dialog", { name: /New project/ });
    const name = within(dialog).getByLabelText("Name") as HTMLInputElement;
    // Focus moves into the dialog once, on opening — straight into its first box.
    expect(document.activeElement).toBe(name);
    await user.click(name);
    await typeKeyByKey(user, name, "Pipeline tie-in");
    expect(name.value).toBe("Pipeline tie-in");

    const code = within(dialog).getByLabelText(/Code/) as HTMLInputElement;
    await user.click(code);
    for (const key of "lng-t5") {
      await user.keyboard(key);
      expect(document.activeElement).toBe(code);
    }
    expect(code.value).toBe("LNG-T5"); // the box upper-cases as you type

    const description = within(dialog).getByLabelText("Description") as HTMLTextAreaElement;
    await user.click(description);
    await typeKeyByKey(user, description, "Second train, phase one");
  });
});

describe("New project: closing hands focus back to the button that opened it", () => {
  it("Escape on an untouched dialog closes it and focus returns to '+ New project'", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "+ New project" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("the Close button does the same", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "+ New project" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("with text typed, Escape asks first (the deliberate discard check), then Discard returns focus", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "+ New project" });
    await user.click(opener);
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipe");

    await user.keyboard("{Escape}");
    expect(screen.getByText(/Discard this new project\?/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    // Opened again, it starts empty: a discarded project is really discarded.
    await user.click(opener);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });
});

describe("Send back note on a contractor's hand-in", () => {
  function renderPanel() {
    render(<SignOffPanel taskId="dt-1" title="Pump skid datasheets" onDone={() => undefined} />, {
      wrapper: Providers,
    });
    return screen.getByRole("button", { name: "Send back" });
  }

  it("keeps the whole note typed key by key, with the cursor in the box", async () => {
    const opener = renderPanel();
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: /Send back/ });
    const note = within(dialog).getByLabelText(/What needs changing/) as HTMLTextAreaElement;
    await user.click(note);
    await typeKeyByKey(user, note, "Please add the pump curve");
  });

  it("Cancel returns focus to Send back and forgets the note; Escape does the same", async () => {
    const opener = renderPanel();
    await user.click(opener);
    let dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText(/What needs changing/));
    await user.keyboard("Half a thought");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    dialog = screen.getByRole("dialog");
    const note = within(dialog).getByLabelText(/What needs changing/) as HTMLTextAreaElement;
    expect(note.value).toBe("");

    await user.click(note);
    await user.keyboard("Another try");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    await user.click(opener);
    expect((screen.getByLabelText(/What needs changing/) as HTMLTextAreaElement).value).toBe("");
  });

  it("a refusal is shown inside the open dialog, not behind it", async () => {
    actions.rejectDisciplineTaskReview.mockResolvedValue({
      ok: false,
      error: "The Detail design phase is locked until FEED is complete.",
    });
    const opener = renderPanel();
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText(/What needs changing/));
    await user.keyboard("Pressure test page 2 missing");
    await user.click(within(dialog).getByRole("button", { name: "Send back" }));

    expect(await within(dialog).findByText(/locked until FEED is complete/)).toBeTruthy();
    expect(actions.rejectDisciplineTaskReview).toHaveBeenCalledWith({
      id: "dt-1",
      note: "Pressure test page 2 missing",
    });
    // The note survives a refusal, so it can be sent again once the reason is sorted.
    expect((within(dialog).getByLabelText(/What needs changing/) as HTMLTextAreaElement).value).toBe(
      "Pressure test page 2 missing",
    );
  });
});

describe("Version history slide-over", () => {
  it("takes focus on opening, and Escape returns focus to the button that opened it", async () => {
    render(<HistoryPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "Version history" });
    await user.click(opener);
    const panel = screen.getByRole("dialog", { name: /Version history for P&ID/ });
    expect(document.activeElement).toBe(panel);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("its close button returns focus too", async () => {
    render(<HistoryPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "Version history" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close version history" }));
    expect(document.activeElement).toBe(opener);
  });
});

describe("Modal: focus return is careful", () => {
  it("does nothing when the opener has left the page (a menu that closed, a deleted row)", async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      const [menu, setMenu] = useState(true);
      return (
        <>
          {menu ? (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setMenu(false);
              }}
            >
              Delete row
            </button>
          ) : null}
          <Modal open={open} title="Delete?" onClose={() => setOpen(false)}>
            <p>Sure?</p>
          </Modal>
        </>
      );
    }
    render(<Page />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Delete row" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when something else took it on purpose while closing", async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <input aria-label="Elsewhere" />
          <Modal
            open={open}
            title="Pick"
            onClose={() => {
              setOpen(false);
              (document.querySelector('[aria-label="Elsewhere"]') as HTMLInputElement).focus();
            }}
          >
            <p>Pick one</p>
          </Modal>
        </>
      );
    }
    render(<Page />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open" }));
    await act(async () => {
      await user.keyboard("{Escape}");
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Elsewhere"));
  });
});

// ---------------------------------------------------------------------------------------------
// Round three (re-test, November 2026).
//
// Fault 3: a dialog opened from a "⋯" menu (Delete comment, Edit post, Delete post) left focus on
// the page itself after Escape, Cancel or the close button. The menu item that was pressed has
// already gone when the dialog opens, so there was nothing to go back to. Those dialogs now hand
// focus back to the row's own "Options for…" button.
//
// Fault 4: Edit project, Edit task details, Override status and Add a discipline task kept what was
// typed after Cancel, Escape or the close button, so reopening showed abandoned text as if it had
// been saved. A cancelled one now goes back to the saved values (or blank).
//
// Fault 5: Escape in New project's "Search people" box closed the whole dialog. Escape now closes
// the search first; only a second Escape reaches the dialog.
// ---------------------------------------------------------------------------------------------

const ME: MeDTO = {
  id: "u-1",
  name: "Aisha Al Balushi",
  email: "aisha@example.com",
  role: "ADMIN",
  disciplineId: null,
} as unknown as MeDTO;

const COMMENT = {
  id: "c-1",
  body: "Datasheet uploaded.",
  authorId: "u-1",
  authorName: "Aisha Al Balushi",
  authorCompanyName: null,
  createdAt: new Date("2026-11-01T08:00:00Z"),
  editedAt: null,
  isDeleted: false,
} as unknown as CommentRowDTO;

const POST = {
  id: "p-1",
  parentId: null,
  title: "Shutdown window",
  body: "The window moves to 14 Dec.",
  authorName: "Aisha Al Balushi",
  canEdit: true,
  canDelete: true,
} as unknown as PostDTO;

describe("Dialogs opened from a '⋯' menu hand focus back to that row's menu button", () => {
  function renderComment() {
    render(
      <ul>
        <CommentRow
          comment={COMMENT}
          me={ME}
          memberNames={[]}
          departmentNames={[]}
          onChanged={() => undefined}
        />
      </ul>,
      { wrapper: Providers },
    );
    return screen.getByRole("button", { name: "Options for Aisha Al Balushi's comment" });
  }

  function renderPost() {
    render(<PostMenu post={POST} onChanged={() => undefined} />, { wrapper: Providers });
    return screen.getByRole("button", { name: "Options for Aisha Al Balushi's post" });
  }

  async function openFromMenu(menuButton: HTMLElement, item: "Edit" | "Delete") {
    await user.click(menuButton);
    await user.click(screen.getByRole("button", { name: item }));
    return screen.getByRole("dialog");
  }

  it("Delete comment: Escape, Cancel and the close button each return focus to the menu button", async () => {
    const menuButton = renderComment();

    await openFromMenu(menuButton, "Delete");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    let dialog = await openFromMenu(menuButton, "Delete");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(menuButton);

    dialog = await openFromMenu(menuButton, "Delete");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(menuButton);
  });

  it("Edit post: typing keeps every letter, and Escape or Cancel return focus to the menu button", async () => {
    const menuButton = renderPost();

    let dialog = await openFromMenu(menuButton, "Edit");
    const body = within(dialog).getByLabelText("Post text") as HTMLTextAreaElement;
    await user.click(body);
    await typeKeyByKey(user, body, " Confirmed");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    // Reopened, it shows the saved post again, not the abandoned edit.
    dialog = await openFromMenu(menuButton, "Edit");
    expect((within(dialog).getByLabelText("Post text") as HTMLTextAreaElement).value).toBe(
      POST.body,
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(menuButton);
  });

  it("Delete post: the close button returns focus to the menu button", async () => {
    const menuButton = renderPost();
    const dialog = await openFromMenu(menuButton, "Delete");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(menuButton);
  });
});

const PROJECT = {
  id: "pr-1",
  name: "Train 5 expansion",
  code: "LNG-T5",
  description: "Second train.",
  status: "ACTIVE",
  startDate: new Date("2026-09-01T00:00:00.000Z"),
  targetDate: new Date("2027-03-31T00:00:00.000Z"),
  externalSignoffRequired: true,
  members: [],
  disciplines: [{ id: "pd-1", disciplineId: "d-mech", name: "Mechanical" }],
} as unknown as ProjectDTO;

const TASK = {
  id: "mt-1",
  projectId: "pr-1",
  title: "Pump skid package",
  description: "Vendor package for the booster pumps.",
  priority: "HIGH",
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  deadline: new Date("2026-12-15T00:00:00.000Z"),
  ownerId: null,
  phaseId: null,
  statusOverride: null,
  counts: { disciplineTasks: 3, completed: 1 },
} as unknown as MainTaskDTO;

/** A page with the opening button and the dialog, the way the project and task screens hold them. */
function DialogPage({
  label,
  dialog,
}: {
  label: string;
  dialog: (open: boolean, close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {dialog(open, () => setOpen(false))}
    </>
  );
}

describe("A cancelled edit goes back to the saved values", () => {
  type Close = "Cancel" | "Escape" | "Close";

  async function closeWith(how: Close) {
    if (how === "Escape") await user.keyboard("{Escape}");
    else await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: how }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }

  for (const how of ["Cancel", "Escape", "Close"] as const) {
    it(`Edit project forgets abandoned typing after ${how}`, async () => {
      render(
        <DialogPage
          label="Edit project"
          dialog={(open, close) => <EditProjectDialog project={PROJECT} open={open} onClose={close} />}
        />,
        { wrapper: Providers },
      );
      const opener = screen.getByRole("button", { name: "Edit project" });
      await user.click(opener);
      const name = screen.getByLabelText("Name") as HTMLInputElement;
      await user.click(name);
      await typeKeyByKey(user, name, " draft");
      await user.click(screen.getByLabelText("Require an internal sign-off"));

      await closeWith(how);
      expect(document.activeElement).toBe(opener);
      await user.click(opener);
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(PROJECT.name);
      expect((screen.getByLabelText("Require an internal sign-off") as HTMLInputElement).checked).toBe(
        true,
      );
    });

    it(`Edit task details forgets abandoned typing after ${how}`, async () => {
      render(
        <DialogPage
          label="Edit details"
          dialog={(open, close) => (
            <EditDetailsDialog task={TASK} project={PROJECT} open={open} onClose={close} />
          )}
        />,
        { wrapper: Providers },
      );
      const opener = screen.getByRole("button", { name: "Edit details" });
      await user.click(opener);
      const title = screen.getByLabelText("Title") as HTMLInputElement;
      await user.click(title);
      await typeKeyByKey(user, title, " v2");
      const description = screen.getByLabelText("Description") as HTMLTextAreaElement;
      await user.click(description);
      await typeKeyByKey(user, description, " Not saved.");

      await closeWith(how);
      expect(document.activeElement).toBe(opener);
      await user.click(opener);
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(TASK.title);
      expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
        TASK.description,
      );
    });

    it(`Override status starts blank again after ${how}`, async () => {
      render(
        <DialogPage
          label="Override status"
          dialog={(open, close) => <OverrideDialog task={TASK} open={open} onClose={close} />}
        />,
        { wrapper: Providers },
      );
      const opener = screen.getByRole("button", { name: "Override status" });
      await user.click(opener);
      await user.selectOptions(screen.getByLabelText("New status"), "BLOCKED");
      const reason = screen.getByLabelText("Reason") as HTMLTextAreaElement;
      await user.click(reason);
      await typeKeyByKey(user, reason, "Vendor late");

      await closeWith(how);
      expect(document.activeElement).toBe(opener);
      await user.click(opener);
      expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("");
      expect((screen.getByLabelText("New status") as HTMLSelectElement).value).toBe("COMPLETED");
    });

    it(`Add a discipline task starts blank again after ${how}`, async () => {
      render(
        <DialogPage
          label="Add discipline task"
          dialog={(open, close) => (
            <AddDisciplineTaskDialog task={TASK} project={PROJECT} open={open} onClose={close} />
          )}
        />,
        { wrapper: Providers },
      );
      const opener = screen.getByRole("button", { name: "Add discipline task" });
      await user.click(opener);
      await user.selectOptions(screen.getByLabelText("Discipline"), "d-mech");
      const title = screen.getByLabelText("Title") as HTMLInputElement;
      await user.click(title);
      await typeKeyByKey(user, title, " extra");
      await user.click(screen.getByRole("checkbox"));

      await closeWith(how);
      expect(document.activeElement).toBe(opener);
      await user.click(opener);
      expect((screen.getByLabelText("Discipline") as HTMLSelectElement).value).toBe("");
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    });
  }
});

describe("New project: the people step", () => {
  /** Fills step 1 (key by key), ticks the one discipline, and lands on step 3. */
  async function goToPeopleStep(me?: MeDTO) {
    render(<NewProjectPage me={me} />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "+ New project" });
    await user.click(opener);
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipeline");
    await user.click(screen.getByLabelText(/Code/));
    await user.keyboard("PL-1");
    // Date boxes are set in one go: jsdom has no date picker to type into key by key.
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2027-06-30" } });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByLabelText(/Mechanical/));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: /step 3 of 3/ })).toBeTruthy();
    return opener;
  }

  it("Escape in 'Search people' closes and clears the search first; only a second Escape reaches the dialog", async () => {
    const opener = await goToPeopleStep();
    await user.click(screen.getByRole("button", { name: "+ Add person" }));
    const search = screen.getByLabelText("Person 1") as HTMLInputElement;
    await user.click(search);
    await typeKeyByKey(user, search, "Sal");
    expect(screen.getByText("Salma Al Harthy")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: /step 3 of 3/ })).toBeTruthy(); // still open
    expect(screen.queryByText("Salma Al Harthy")).toBeNull(); // the list closed
    expect(search.value).toBe(""); // and the search was cleared
    expect(document.activeElement).toBe(search);
    expect(screen.queryByText(/Discard this new project\?/)).toBeNull();

    // The second Escape is the dialog's: something was typed, so it asks before discarding.
    await user.keyboard("{Escape}");
    expect(screen.getByText(/Discard this new project\?/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("the same search inside any other dialog: first Escape for the search, second for the dialog", async () => {
    const { UserPicker } = await import("@/components/people/user-picker");
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Add a member
          </button>
          <Modal open={open} title="Add a member" onClose={() => setOpen(false)}>
            <UserPicker value={null} onChange={() => undefined} />
          </Modal>
        </>
      );
    }
    render(<Page />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "Add a member" });
    await user.click(opener);
    await user.click(screen.getByLabelText("Search people"));
    await user.keyboard("Ha");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("each person's row has one × with a name that says what it removes", async () => {
    await goToPeopleStep(ME);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove Aisha Al Balushi from this project" })).toBeTruthy();
  });

  it("the project manager line is a quiet hint until the team list is changed", async () => {
    await goToPeopleStep();
    // With nobody on the list at all, the line says what to do, in grey that is still readable
    // (--brand-text, well over 4.5:1 on white — --brand-gray is not).
    const hint = screen.getByText(
      "Add at least one person — a project needs at least one project manager.",
    );
    expect(hint.className).toContain("--brand-text");
    // Create project is greyed out with no row to point at; a screen reader is told why.
    const create = screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.getAttribute("aria-describedby")).toBe(hint.id);
    await user.click(screen.getByRole("button", { name: "+ Add person" }));
    expect(screen.getByText("A project needs at least one project manager.").className).toContain(
      "--status-blocked",
    );
  });

  it("with the creator already a project manager, the line is not shown at all", async () => {
    await goToPeopleStep(ME);
    expect(screen.queryByText("A project needs at least one project manager.")).toBeNull();
  });
});

describe("The sign-in code box takes digits only", () => {
  function CodeBox() {
    const [code, setCode] = useState("");
    return <OneTimeCodeInput name="code" value={code} onChange={setCode} />;
  }

  it("refuses letters typed key by key, with a plain note, and keeps the digits", async () => {
    render(<CodeBox />);
    const box = screen.getByLabelText("Verification code") as HTMLInputElement;
    await user.click(box);
    for (const key of "12a4") await user.keyboard(key);
    expect(box.value).toBe("124");
    expect(screen.getByText(/The code is numbers only/)).toBeTruthy();
    await user.keyboard("567");
    expect(box.value).toBe("124567");
    expect(screen.queryByText(/The code is numbers only/)).toBeNull();
    await user.keyboard("8"); // a seventh digit is not taken
    expect(box.value).toBe("124567");
  });

  it("a pasted code still works, with or without the space authenticator apps show", async () => {
    render(<CodeBox />);
    const box = screen.getByLabelText("Verification code") as HTMLInputElement;
    await user.click(box);
    await user.paste("482 913");
    expect(box.value).toBe("482913");
    expect(screen.queryByText(/The code is numbers only/)).toBeNull();
  });

  it("cleans the way the box does", () => {
    expect(cleanOneTimeCode("123456")).toEqual({ code: "123456", refused: false });
    expect(cleanOneTimeCode("123-456")).toEqual({ code: "123456", refused: false });
    expect(cleanOneTimeCode("12345a")).toEqual({ code: "12345", refused: true });
    expect(cleanOneTimeCode("1234567")).toEqual({ code: "123456", refused: false });
  });
});

describe("No dialog or panel may tie its focus step to a callback prop", () => {
  // A guard for the next dialog somebody writes: an effect that moves focus must not re-run when a
  // callback such as onClose changes, or typing will lose the cursor exactly as above.
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
      return full.endsWith(".tsx") ? [full] : [];
    });
  }

  it("every focus-moving effect in src/ leaves callback props out of its dependencies", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.resolve(__dirname, "../.."))) {
      const source = readFileSync(file, "utf8");
      for (const chunk of source.split("useEffect(").slice(1)) {
        const end = chunk.search(/\},\s*\[[^\]]*\]\s*\)/);
        if (end === -1) continue;
        const body = chunk.slice(0, end);
        const deps = /\},\s*\[([^\]]*)\]/.exec(chunk.slice(end))?.[1] ?? "";
        if (body.includes(".focus(") && /\bon[A-Z]\w*/.test(deps)) {
          offenders.push(`${path.relative(process.cwd(), file)}: [${deps.trim()}]`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Editing a comment inline (from the '⋯' menu)", () => {
  function renderComment(inDialog = false) {
    const row = (
      <ul>
        <CommentRow
          comment={COMMENT}
          me={ME}
          memberNames={[]}
          departmentNames={[]}
          onChanged={() => undefined}
        />
      </ul>
    );
    render(
      inDialog ? (
        <Modal open title="Task panel" onClose={() => undefined}>
          {row}
        </Modal>
      ) : (
        row
      ),
      { wrapper: Providers },
    );
    return screen.getByRole("button", { name: "Options for Aisha Al Balushi's comment" });
  }

  /** Keyboard only: focus the "⋯" button, Enter, Tab to Edit, Enter. */
  async function openEditByKeyboard(menuButton: HTMLElement) {
    act(() => menuButton.focus());
    await user.keyboard("{Enter}");
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Edit");
    await user.keyboard("{Enter}");
    return screen.getByLabelText("Edit your comment") as HTMLTextAreaElement;
  }

  it("puts the cursor in the box, at the end, and keeps every letter typed", async () => {
    const menuButton = renderComment();
    const box = await openEditByKeyboard(menuButton);
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(COMMENT.body.length);
    expect(box.selectionEnd).toBe(COMMENT.body.length);
    await typeKeyByKey(user, box, " Rev B");
    expect(box.value).toBe(`${COMMENT.body} Rev B`);
  });

  it("Escape in the box cancels the edit and returns focus to the row's menu button", async () => {
    const menuButton = renderComment();
    const box = await openEditByKeyboard(menuButton);
    await typeKeyByKey(user, box, " draft");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Edit your comment")).toBeNull();
    expect(document.activeElement).toBe(menuButton);
    expect(screen.getByText(COMMENT.body)).toBeTruthy();
    // Opening it again starts from the saved text, not the abandoned draft.
    const again = await openEditByKeyboard(menuButton);
    expect(again.value).toBe(COMMENT.body);
  });

  it("inside a dialog, that Escape is the edit's only — the dialog stays open", async () => {
    const menuButton = renderComment(true);
    await openEditByKeyboard(menuButton);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Task panel" })).toBeTruthy();
    expect(document.activeElement).toBe(menuButton);
  });
});

describe("After a comment is deleted, focus moves to a neighbour", () => {
  // The page behind the "Delete this comment?" check is inert until it closes, exactly as in Chrome.
  refuseFocusInsideInert();

  const SECOND = {
    ...COMMENT,
    id: "c-2",
    body: "Checked, thanks.",
    authorName: "Salma Al Harthy",
    authorId: "u-1",
  } as unknown as CommentRowDTO;

  /** The thread's shape: the comment box above the list; a deleted comment shows as removed. */
  function Thread({ initial }: { initial: CommentRowDTO[] }) {
    const [comments, setComments] = useState(initial);
    return (
      <div data-comment-thread>
        <textarea aria-label="Add a comment" />
        <ul>
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              me={ME}
              memberNames={[]}
              departmentNames={[]}
              onChanged={() =>
                setComments((current) =>
                  current.map((item) =>
                    deleted.has(item.id) ? ({ ...item, isDeleted: true } as CommentRowDTO) : item,
                  ),
                )
              }
            />
          ))}
        </ul>
      </div>
    );
  }

  const deleted = new Set<string>();
  beforeEach(() => {
    deleted.clear();
    actions.deleteComment.mockReset();
    actions.deleteComment.mockImplementation(async ({ id }: { id: string }) => {
      deleted.add(id);
      return { ok: true, data: null };
    });
  });

  async function deleteByKeyboard(authorName: string) {
    const menuButton = screen.getByRole("button", { name: `Options for ${authorName}'s comment` });
    act(() => menuButton.focus());
    await user.keyboard("{Enter}");
    await user.tab(); // Edit
    await user.tab(); // Delete
    expect(document.activeElement?.textContent).toBe("Delete");
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("goes to the next comment's menu button", async () => {
    render(<Thread initial={[COMMENT, SECOND]} />, { wrapper: Providers });
    await deleteByKeyboard("Aisha Al Balushi");
    await vi.waitFor(() => expect(screen.getByText("Comment removed")).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Options for Salma Al Harthy's comment" }),
    );
  });

  it("goes to the comment above when the last one is deleted", async () => {
    render(<Thread initial={[COMMENT, SECOND]} />, { wrapper: Providers });
    await deleteByKeyboard("Salma Al Harthy");
    await vi.waitFor(() => expect(screen.getByText("Comment removed")).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Options for Aisha Al Balushi's comment" }),
    );
  });

  it("goes to the comment box when no other comment can be acted on", async () => {
    render(<Thread initial={[COMMENT]} />, { wrapper: Providers });
    await deleteByKeyboard("Aisha Al Balushi");
    await vi.waitFor(() => expect(screen.getByText("Comment removed")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByLabelText("Add a comment"));
  });
});

describe("New project: removing a person keeps focus in the dialog", () => {
  async function peopleStepWithRows(count: number) {
    render(<NewProjectPage me={ME} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipeline");
    await user.click(screen.getByLabelText(/Code/));
    await user.keyboard("PL-1");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2027-06-30" } });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByLabelText(/Mechanical/));
    await user.click(screen.getByRole("button", { name: "Next" }));
    for (let added = 1; added < count; added += 1) {
      await user.click(screen.getByRole("button", { name: "+ Add person" }));
    }
    return screen.getAllByRole("button", { name: /^Remove / });
  }

  it("the next row's × takes focus", async () => {
    const [first] = await peopleStepWithRows(3);
    act(() => first.focus());
    await user.keyboard("{Enter}");
    const remaining = screen.getAllByRole("button", { name: /^Remove / });
    expect(remaining).toHaveLength(2);
    expect(document.activeElement).toBe(remaining[0]);
    expect(remaining[0].getAttribute("aria-label")).toBe("Remove this empty row");
  });

  it("removing the last row moves to the row above", async () => {
    const rows = await peopleStepWithRows(2);
    act(() => rows[1].focus());
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Aisha Al Balushi from this project" }),
    );
  });

  it("removing the only row moves to '+ Add person'", async () => {
    const [only] = await peopleStepWithRows(1);
    act(() => only.focus());
    await user.keyboard("{Enter}");
    expect(screen.queryAllByRole("button", { name: /^Remove / })).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Add person" }));
  });

  it("a greyed-out Create project says which row is holding it back, and why", async () => {
    await peopleStepWithRows(2);
    const create = screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    // Just added: the row's note is grey help, not a red error — nothing has gone wrong yet.
    const rowNote = screen.getByText("Pick a person for this row, or remove it.");
    expect(rowNote.className).toContain("--brand-text");
    // The summary names the row by what is on screen, never an invisible "Person 2".
    const summary = screen.getByText("Finish the empty row to create the project.");
    expect(summary.id).toBe(create.getAttribute("aria-describedby"));
    expect(summary.className).toContain("--brand-text");

    // Moving on from the row (Tab out of it) turns its note red.
    // (The row's last box is its Discipline list; the next Tab stop is "+ Add person".)
    act(() => screen.getAllByLabelText("Discipline")[1].focus());
    expect(screen.getByText("Pick a person for this row, or remove it.").className).toContain(
      "--brand-text",
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Add person" }));
    expect(screen.getByText("Pick a person for this row, or remove it.").className).toContain(
      "--status-blocked",
    );

    // Picking an engineer with no discipline changes the reason on the row.
    await user.click(screen.getByLabelText("Person 2"));
    await user.keyboard("Sal");
    await user.click(screen.getByText("Salma Al Harthy"));
    expect(screen.getByText("Choose a discipline for this engineer.")).toBeTruthy();
    expect(screen.getByText("Finish Salma Al Harthy to create the project.")).toBeTruthy();

    const disciplineBoxes = screen.getAllByLabelText("Discipline");
    await user.selectOptions(disciplineBoxes[1], "d-mech");
    expect(screen.queryByText(/to create the project\./)).toBeNull();
    expect(create.disabled).toBe(false);
    expect(create.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("A refusal about a field is said once, under that field", () => {
  const MESSAGE = "A user with this email already exists.";

  function Form({ shownOnFields }: { shownOnFields?: string[] }) {
    const { run, error, fieldErrors } = useAction();
    return (
      <div>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Email" error={fieldError(fieldErrors, "email")}>
          <Input defaultValue="salma@example.com" />
        </Field>
        <button
          type="button"
          onClick={() =>
            run(async () => ({ ok: false as const, error: MESSAGE, fieldErrors: { email: [MESSAGE] } }), {
              failure: "Couldn't create this user. Try again.",
              shownOnFields,
            })
          }
        >
          Create user
        </button>
      </div>
    );
  }

  it("a duplicate email shows only under the Email field — no banner, no toast", async () => {
    render(<Form shownOnFields={["name", "email"]} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Create user" }));
    await vi.waitFor(() => expect(screen.getAllByText(MESSAGE)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });

  it("a form that does not name its fields keeps the banner and toast", async () => {
    render(<Form />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Create user" }));
    await vi.waitFor(() => expect(screen.getAllByText(MESSAGE).length).toBeGreaterThan(1));
  });
});

// Round 7 (keyboard and screen-reader re-test). Fault: Tab from a dialog's last button walked out
// to the page behind it ("Privacy notice"), and pressing Next on New project's first step dropped
// focus onto the page itself. The shared Modal now keeps Tab inside the dialog and switches the
// page behind off (inert and aria-hidden) until it closes; New project moves focus to the new
// step's heading. And a refusal shown only under a field was silent for a screen reader: the field
// is now marked invalid, tied to its message, the message is announced, and focus moves to it.

/** Presses Tab (or Shift+Tab) `times` times and checks focus never leaves `dialog`. */
async function expectTabStaysInside(dialog: HTMLElement, times = 12) {
  for (const shift of [false, true]) {
    for (let press = 0; press < times; press += 1) {
      await user.tab({ shift });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  }
}

describe("Keyboard focus stays inside an open dialog", () => {
  it("New project: Tab goes round the dialog and never reaches the page behind", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "+ New project" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: /New project/ });

    // The page behind is switched off for the mouse, the keyboard and a screen reader alike.
    const pageLink = screen.getByText("Top of the page");
    expect(pageLink.hasAttribute("inert")).toBe(true);
    expect(pageLink.getAttribute("aria-hidden")).toBe("true");
    // The toasts stay audible.
    expect(document.querySelector("[aria-live]")?.hasAttribute("inert")).toBe(false);

    // The dialog opens in its Name box. Shift+Tab from there goes back to Close, and once more
    // round to the last stop (Next is greyed out until step 1 is filled, so that is the
    // Description box); Tab from there comes round to Close.
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Name"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Description"));
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    await expectTabStaysInside(dialog);

    await user.keyboard("{Escape}");
    expect(pageLink.hasAttribute("inert")).toBe(false);
    expect(pageLink.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("New project: Next and Back move focus into the new step, never onto the page", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipeline");
    await user.tab();
    await user.keyboard("PL-1");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2027-06-30" } });

    act(() => screen.getByRole("button", { name: "Next" }).focus());
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Which disciplines are involved in this project?" }),
    );
    // Tab from the heading reaches the first discipline, inside the dialog.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/Mechanical/));
    await user.keyboard(" ");

    act(() => screen.getByRole("button", { name: "Next" }).focus());
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Add people to this project" }));
    const dialog = screen.getByRole("dialog", { name: /step 3 of 3/ });
    await expectTabStaysInside(dialog);

    act(() => within(dialog).getByRole("button", { name: "Back" }).focus());
    await user.keyboard("{Enter}");
    act(() => within(dialog).getByRole("button", { name: "Back" }).focus());
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Pipeline");
  });

  it("a Tab pressed while focus has dropped onto the page lands back inside the dialog", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    const dialog = screen.getByRole("dialog");
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("typing and then Tab: every letter stays, and Tab still moves on inside the dialog", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    const dialog = screen.getByRole("dialog");
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await user.click(name);
    await typeKeyByKey(user, name, "Pipeline tie-in");
    await user.tab();
    const code = screen.getByLabelText(/Code/) as HTMLInputElement;
    expect(document.activeElement).toBe(code);
    await typeKeyByKey(user, code, "PL");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("every other dialog keeps Tab inside it too", async () => {
    const dialogs: { label: string; dialog: (open: boolean, close: () => void) => ReactNode }[] = [
      {
        label: "Edit project",
        dialog: (open, close) => <EditProjectDialog project={PROJECT} open={open} onClose={close} />,
      },
      {
        label: "Edit details",
        dialog: (open, close) => (
          <EditDetailsDialog task={TASK} project={PROJECT} open={open} onClose={close} />
        ),
      },
      {
        label: "Override status",
        dialog: (open, close) => <OverrideDialog task={TASK} open={open} onClose={close} />,
      },
      {
        label: "Add discipline task",
        dialog: (open, close) => (
          <AddDisciplineTaskDialog task={TASK} project={PROJECT} open={open} onClose={close} />
        ),
      },
    ];
    for (const { label, dialog } of dialogs) {
      const view = render(<DialogPage label={label} dialog={dialog} />, { wrapper: Providers });
      const opener = screen.getByRole("button", { name: label });
      await user.click(opener);
      await expectTabStaysInside(screen.getByRole("dialog"));
      await user.keyboard("{Escape}");
      expect(document.activeElement).toBe(opener);
      view.unmount();
    }
  });

  it("the Send back note and the version history panel keep Tab inside too", async () => {
    const panel = render(
      <SignOffPanel taskId="dt-1" title="Pump skid datasheets" onDone={() => undefined} />,
      { wrapper: Providers },
    );
    await user.click(screen.getByRole("button", { name: "Send back" }));
    await expectTabStaysInside(screen.getByRole("dialog"));
    panel.unmount();

    render(<HistoryPage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "Version history" });
    await user.click(opener);
    expect(opener.hasAttribute("inert")).toBe(true);
    await expectTabStaysInside(screen.getByRole("dialog"));
    await user.keyboard("{Escape}");
    expect(opener.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("a dialog opened from inside another hands the page back to the outer one when it closes", async () => {
    function Nested() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuter(true)}>
            Open outer
          </button>
          <Modal open={outer} title="Outer" onClose={() => setOuter(false)}>
            <button type="button" onClick={() => setInner(true)}>
              Open inner
            </button>
          </Modal>
          <Modal open={inner} title="Inner" onClose={() => setInner(false)}>
            <p>Inner text</p>
          </Modal>
        </>
      );
    }
    render(<Nested />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open outer" }));
    const openInner = screen.getByRole("button", { name: "Open inner" });
    await user.click(openInner);
    const inner = screen.getByRole("dialog", { name: "Inner" });
    expect(openInner.closest("[inert]")).not.toBeNull(); // the outer dialog is behind now
    await expectTabStaysInside(inner, 4);
    await user.click(within(inner).getByRole("button", { name: "Close" }));
    expect(openInner.closest("[inert]")).toBeNull(); // the outer dialog is live again
    expect(screen.getByText("Open outer").closest("[inert]")).not.toBeNull();
    expect(document.activeElement).toBe(openInner);
  });
});

describe("A refusal shown under a field is heard, not just seen", () => {
  const MESSAGE = "A user with this email already exists.";

  function Form() {
    const { run, fieldErrors } = useAction();
    return (
      <div role="dialog" aria-label="New user">
        <Field label="Name">
          <Input defaultValue="Salma" />
        </Field>
        <Field label="Email" hint="Their work address." error={fieldError(fieldErrors, "email")}>
          <Input defaultValue="salma@example.com" />
        </Field>
        <button
          type="button"
          onClick={() =>
            run(async () => ({ ok: false as const, error: MESSAGE, fieldErrors: { email: [MESSAGE] } }), {
              failure: "Couldn't create this user. Try again.",
              shownOnFields: ["email"],
            })
          }
        >
          Create user
        </button>
      </div>
    );
  }

  it("before a refusal, the box points at its help line and is not marked invalid", () => {
    render(<Form />, { wrapper: Providers });
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById(email.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Their work address.",
    );
  });

  it("after a keyboard submit: the box is invalid, tied to an announced message, and has focus", async () => {
    render(<Form />, { wrapper: Providers });
    act(() => screen.getByRole("button", { name: "Create user" }).focus());
    await user.keyboard("{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(MESSAGE);
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(alert.id);
    // The message is not folded into the box's name — it is read once, as its description.
    expect(screen.getByLabelText("Email")).toBe(email);
    await vi.waitFor(() => expect(document.activeElement).toBe(email));
    // The other box is left alone.
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Add discipline", () => {
  beforeEach(() => {
    actions.createDiscipline.mockReset();
  });

  it("Enter in a box saves, and a taken code is announced with focus on the Code box", async () => {
    actions.createDiscipline.mockResolvedValue({
      ok: false,
      error: "That code is already used.",
      fieldErrors: { code: ["That code is already used."] },
    });
    render(<AdminDisciplinesView disciplines={[]} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ Add discipline" }));
    await user.click(screen.getByLabelText("Code"));
    await user.keyboard("MECH");
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Mechanical{Enter}");
    expect(actions.createDiscipline).toHaveBeenCalledTimes(1);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That code is already used.");
    const code = screen.getByLabelText("Code");
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(code.getAttribute("aria-describedby")).toBe(alert.id);
    await vi.waitFor(() => expect(document.activeElement).toBe(code));
  });

  it("Enter with a required box still empty does nothing", async () => {
    render(<AdminDisciplinesView disciplines={[]} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ Add discipline" }));
    await user.click(screen.getByLabelText("Code"));
    await user.keyboard("MECH{Enter}");
    expect(actions.createDiscipline).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Small dialog fixes", () => {
  it("Delete comment opens on its safe Cancel button", async () => {
    render(
      <ul>
        <CommentRow
          comment={COMMENT}
          me={ME}
          memberNames={[]}
          departmentNames={[]}
          onChanged={() => undefined}
        />
      </ul>,
      { wrapper: Providers },
    );
    await user.click(screen.getByRole("button", { name: "Options for Aisha Al Balushi's comment" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  it("editing a post is titled 'Edit post' — an administrator may be editing somebody else's", async () => {
    render(<PostMenu post={POST} onChanged={() => undefined} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Options for Aisha Al Balushi's post" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit post" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Round eight (re-test, November 2026).
//
// Fault 1: after deleting a comment, focus dropped to the top of the page. The move to the next
// comment ran while the "Delete this comment?" check was still open — and the page behind an open
// dialog is inert, so the browser refused it (jsdom does not, which is why the round-seven tests
// passed; the tests here now refuse focus inside inert the way Chrome does). Modal now takes
// `focusAfterCloseRef`: the dialog names where focus goes, and the Modal moves it once it has
// closed and the page is live again. Removing a team member and deleting a post use it too.
//
// Fault 5: "+ Add person" on New project's people step left focus on the link; it now puts the
// cursor in the new row's search box.
// ---------------------------------------------------------------------------------------------

describe("Removing a team member moves focus to a neighbour, after the check closes", () => {
  refuseFocusInsideInert();

  const member = (userId: string, userName: string, projectRole = "ENGINEER") => ({
    id: `pm-${userId}`,
    userId,
    userName,
    userEmail: `${userId}@example.com`,
    projectRole,
    disciplineId: projectRole === "PROJECT_MANAGER" ? null : "d-mech",
    disciplineCode: projectRole === "PROJECT_MANAGER" ? null : "MECH",
  });
  const TEAM = {
    ...PROJECT,
    members: [
      member("u-1", "Aisha Al Balushi", "PROJECT_MANAGER"),
      member("u-2", "Salma Al Harthy"),
      member("u-3", "Hamed Al Busaidi"),
    ],
    disciplines: [
      {
        id: "pd-1",
        disciplineId: "d-mech",
        name: "Mechanical",
        code: "MECH",
        colorHex: "#1F6FEB",
        leadId: null,
        leadName: null,
      },
    ],
  } as unknown as ProjectDTO;

  beforeEach(() => {
    actions.removeMember.mockReset();
    actions.removeMember.mockResolvedValue({ ok: true, data: null });
  });

  /** Keyboard only: focus the person's Remove, Enter, Tab from Cancel to Remove, Enter. */
  async function removeByKeyboard(name: string) {
    act(() => screen.getByRole("button", { name: `Remove ${name}` }).focus());
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Remove from project" });
    const confirm = within(dialog).getAllByRole("button", { name: "Remove" }).pop() as HTMLElement;
    act(() => confirm.focus());
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("goes to the next member's Remove", async () => {
    render(<ProjectTeamTab project={TEAM} canManage />, { wrapper: Providers });
    await removeByKeyboard("Salma Al Harthy");
    expect(actions.removeMember).toHaveBeenCalledWith({ projectId: "pr-1", userId: "u-2" });
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Remove Hamed Al Busaidi" }),
      ),
    );
  });

  it("still lands on the next member when the list refreshes before their Remove is enabled again", async () => {
    // In the browser the refreshed list (without the removed person) can arrive while the other
    // Remove buttons are still greyed out by the request. The neighbour is chosen once, while the
    // removed row is still there, and kept — round eight's first browser run fell to "+ Add member".
    let drop: (userId: string) => void = () => undefined;
    function Harness() {
      const [project, setProject] = useState(TEAM);
      drop = (userId) =>
        setProject((current) => ({
          ...current,
          members: current.members.filter((item) => item.userId !== userId),
        }));
      return <ProjectTeamTab project={project} canManage />;
    }
    actions.removeMember.mockImplementation(async ({ userId }: { userId: string }) => {
      setTimeout(() => act(() => drop(userId)), 20);
      return { ok: true, data: null };
    });
    render(<Harness />, { wrapper: Providers });
    await removeByKeyboard("Salma Al Harthy");
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove Salma Al Harthy" })).toBeNull(),
    );
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Remove Hamed Al Busaidi" }),
      ),
    );
  });

  it("goes to the member above when the last one is removed", async () => {
    render(<ProjectTeamTab project={TEAM} canManage />, { wrapper: Providers });
    await removeByKeyboard("Hamed Al Busaidi");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Remove Salma Al Harthy" }),
      ),
    );
  });

  it("goes to '+ Add member' when nobody else is listed", async () => {
    const alone = { ...TEAM, members: [member("u-2", "Salma Al Harthy")] } as unknown as ProjectDTO;
    render(<ProjectTeamTab project={alone} canManage />, { wrapper: Providers });
    await removeByKeyboard("Salma Al Harthy");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Add member" })),
    );
  });

  it("Cancel still returns focus to the Remove that opened it", async () => {
    render(<ProjectTeamTab project={TEAM} canManage />, { wrapper: Providers });
    const opener = screen.getByRole("button", { name: "Remove Salma Al Harthy" });
    act(() => opener.focus());
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(actions.removeMember).not.toHaveBeenCalled();
  });

  it("each discipline's Remove names the discipline, and a greyed-out one says why", () => {
    render(<ProjectTeamTab project={TEAM} canManage />, { wrapper: Providers });
    const remove = screen.getByRole("button", { name: "Remove Mechanical" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    const why = document.getElementById(remove.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent).toBe(
      "Mechanical still has 2 members on this project. Move or remove them all first.",
    );
  });
});

describe("Deleting a post moves focus to a neighbour, after the check closes", () => {
  refuseFocusInsideInert();

  const OTHER = { ...POST, id: "p-2", authorName: "Salma Al Harthy" } as unknown as PostDTO;

  beforeEach(() => {
    actions.deletePost.mockReset();
    actions.deletePost.mockResolvedValue({ ok: true, data: null });
  });

  function Board({ posts }: { posts: PostDTO[] }) {
    return (
      <div role="tabpanel">
        <textarea aria-label="Write to Everyone" />
        {posts.map((post) => (
          <PostMenu key={post.id} post={post} onChanged={() => undefined} />
        ))}
      </div>
    );
  }

  async function deleteByKeyboard(authorName: string) {
    act(() => screen.getByRole("button", { name: `Options for ${authorName}'s post` }).focus());
    await user.keyboard("{Enter}");
    await user.tab(); // Edit
    await user.tab(); // Delete
    expect(document.activeElement?.textContent).toBe("Delete");
    await user.keyboard("{Enter}");
    // The check opens on Cancel; Tab to its Delete.
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Delete");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("goes to the next post's menu button", async () => {
    render(<Board posts={[POST, OTHER]} />, { wrapper: Providers });
    await deleteByKeyboard("Aisha Al Balushi");
    expect(actions.deletePost).toHaveBeenCalledWith({ id: "p-1" });
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Options for Salma Al Harthy's post" }),
      ),
    );
  });

  it("goes to the post above when the last one is deleted", async () => {
    render(<Board posts={[POST, OTHER]} />, { wrapper: Providers });
    await deleteByKeyboard("Salma Al Harthy");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Options for Aisha Al Balushi's post" }),
      ),
    );
  });

  it("goes to the board's 'Write to' box when it was the only post", async () => {
    render(<Board posts={[POST]} />, { wrapper: Providers });
    await deleteByKeyboard("Aisha Al Balushi");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Write to Everyone")),
    );
  });
});

describe("Modal: focusAfterCloseRef", () => {
  refuseFocusInsideInert();

  it("moves focus only after the dialog has closed and the page is live again", async () => {
    const seen: { inert: boolean; dialogOpen: boolean }[] = [];
    function Page() {
      const [open, setOpen] = useState(false);
      const after = useRef<FocusAfterClose | null>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <button type="button">Neighbour</button>
          <Modal open={open} title="Delete?" focusAfterCloseRef={after} onClose={() => setOpen(false)}>
            <button
              type="button"
              onClick={() => {
                after.current = () => {
                  const target = screen.getByRole("button", { name: "Neighbour" });
                  seen.push({
                    inert: target.closest("[inert]") !== null,
                    dialogOpen: document.querySelector('[role="dialog"]') !== null,
                  });
                  return target;
                };
                setOpen(false);
              }}
            >
              Confirm
            </button>
          </Modal>
        </>
      );
    }
    render(<Page />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(seen).toEqual([{ inert: false, dialogOpen: false }]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Neighbour" }));

    // Used once: the next close, a plain Escape, goes back to the opener as always.
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
  });
});

describe("New project: '+ Add person' puts the cursor in the new row", () => {
  async function peopleStep() {
    render(<NewProjectPage me={ME} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipeline");
    await user.click(screen.getByLabelText(/Code/));
    await user.keyboard("PL-1");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2027-06-30" } });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByLabelText(/Mechanical/));
    await user.click(screen.getByRole("button", { name: "Next" }));
  }

  it("Enter on '+ Add person' focuses the new row's search box, ready to type", async () => {
    await peopleStep();
    act(() => screen.getByRole("button", { name: "+ Add person" }).focus());
    await user.keyboard("{Enter}");
    const search = screen.getByLabelText("Person 2") as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    await typeKeyByKey(user, search, "Sal");
    expect(screen.getByText("Salma Al Harthy")).toBeTruthy();
  });

  it("the people list closes once focus leaves the search, so it cannot cover what is below", async () => {
    await peopleStep();
    await user.click(screen.getByRole("button", { name: "+ Add person" }));
    await user.keyboard("Sal");
    expect(screen.getByText("Salma Al Harthy")).toBeTruthy();
    // Tab into the list keeps it open; Tab past its last person closes it.
    await user.tab();
    expect(document.activeElement?.textContent).toContain("Salma Al Harthy");
    await user.tab();
    expect(document.activeElement?.textContent).toContain("Hamed Al Busaidi");
    expect(screen.getByText("Salma Al Harthy")).toBeTruthy();
    await user.tab();
    expect(screen.queryByText("Salma Al Harthy")).toBeNull();
    // The search keeps what was typed, and focusing it again brings the list back.
    const search = screen.getByLabelText("Person 2") as HTMLInputElement;
    expect(search.value).toBe("Sal");
    await user.click(search);
    expect(screen.getByText("Salma Al Harthy")).toBeTruthy();
  });
});

describe("Add discipline: a refusal under a field goes once the field changes", () => {
  beforeEach(() => {
    actions.createDiscipline.mockReset();
    actions.createDiscipline.mockResolvedValue({
      ok: false,
      error: "That code is already used.",
      fieldErrors: { code: ["That code is already used."] },
    });
  });

  it("clearing the Code removes the red line and the invalid mark; the next refusal brings it back", async () => {
    render(<AdminDisciplinesView disciplines={[]} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ Add discipline" }));
    await user.click(screen.getByLabelText("Code"));
    await user.keyboard("MECH");
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Mechanical{Enter}");
    await screen.findByRole("alert");
    const code = screen.getByLabelText("Code") as HTMLInputElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(code));

    for (let left = code.value.length; left > 0; left -= 1) await user.keyboard("{Backspace}");
    expect(code.value).toBe("");
    expect(screen.queryByText("That code is already used.")).toBeNull();
    expect(code.getAttribute("aria-invalid")).toBeNull();
    // Its ordinary hint is back under the box.
    expect(screen.getByText("Short, like MECH.")).toBeTruthy();

    await user.keyboard("MECH");
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("That code is already used.");
  });
});

// ---------------------------------------------------------------------------------------------
// Round nine (November 2026 browser test): four places where keyboard focus fell onto the page.
//
// 1. Picking a person with Enter in the people search swapped the search for the picked person;
//    the list item that had focus was gone, and the next Tab went to the dialog's Close button.
// 2. New project: a taken project code was refused on step 3, where the Code box is not shown.
// 3. The red "already exists" banner stayed after the code had been changed.
// 4. Removing Slack just after saving its address left focus at the top of the page once the card
//    took longer than two seconds to redraw.
// ---------------------------------------------------------------------------------------------

describe("Picking a person with the keyboard keeps focus in the dialog", () => {
  async function newProjectPeopleStep() {
    render(<NewProjectPage me={ME} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipeline");
    await user.click(screen.getByLabelText(/Code/));
    await user.keyboard("PL-1");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2027-06-30" } });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByLabelText(/Mechanical/));
    await user.click(screen.getByRole("button", { name: "Next" }));
  }

  it("New project: Enter on a person lands on that person, and Tab carries on along the row", async () => {
    await newProjectPeopleStep();
    act(() => screen.getByRole("button", { name: "+ Add person" }).focus());
    await user.keyboard("{Enter}");
    await user.keyboard("Sal");
    await user.tab();
    expect(document.activeElement?.textContent).toContain("Salma Al Harthy");
    await user.keyboard("{Enter}");

    const picked = screen.getByRole("group", { name: "Person 2: Salma Al Harthy" });
    expect(document.activeElement).toBe(picked);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Salma Al Harthy from this project" }),
    );
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("Add member: Enter on a person lands on that person; Tab reaches its × and then the role", async () => {
    render(<ProjectTeamTab project={PROJECT} canManage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ Add member" }));
    await user.click(screen.getByLabelText("Person"));
    await user.keyboard("Ham");
    await user.tab();
    await user.tab();
    expect(document.activeElement?.textContent).toContain("Hamed Al Busaidi");
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "Person: Hamed Al Busaidi" }),
    );
    await user.tab();
    const clear = screen.getByRole("button", { name: "Remove Hamed Al Busaidi" });
    expect(document.activeElement).toBe(clear);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Project role"));

    // Clearing the person puts the cursor back in the search, ready for another name.
    act(() => clear.focus());
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Person"));
  });
});

describe("New project: a taken code is refused on the step that has the Code box", () => {
  const TAKEN = "A project with that code already exists.";

  async function createFromStepThree() {
    render(<NewProjectPage me={ME} />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("Pipeline");
    await user.click(screen.getByLabelText(/Code/));
    await user.keyboard("PL-1");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2027-06-30" } });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByLabelText(/Mechanical/));
    await user.click(screen.getByRole("button", { name: "Next" }));
    act(() => screen.getByRole("button", { name: "Create project" }).focus());
    await user.keyboard("{Enter}");
  }

  beforeEach(() => {
    actions.createProject.mockReset();
    actions.createProject.mockResolvedValue({
      ok: false,
      error: `${TAKEN} Choose another code.`,
      fieldErrors: { code: [TAKEN] },
    });
  });

  it("goes back to step 1, says it once under the Code box, and puts the cursor there", async () => {
    await createFromStepThree();
    expect(actions.createProject).toHaveBeenCalledTimes(1);
    await screen.findByRole("dialog", { name: /step 1 of 3/ });
    const code = screen.getByLabelText(/Code/) as HTMLInputElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(code));
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(TAKEN);
    // Said once: no banner repeating it above the form.
    expect(screen.queryByText(`${TAKEN} Choose another code.`)).toBeNull();
    // Everything typed is still there.
    expect(code.value).toBe("PL-1");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Pipeline");

    // Changing the code takes the refusal away.
    await user.keyboard("{Backspace}2");
    expect(code.value).toBe("PL-2");
    expect(screen.queryByText(TAKEN)).toBeNull();
    expect(code.getAttribute("aria-invalid")).toBeNull();
  });

  it("a banner that came with the refusal goes as soon as the code is changed", async () => {
    // A refusal that also names something not on step 1 keeps its banner — until the code changes.
    actions.createProject.mockResolvedValue({
      ok: false,
      error: `${TAKEN} Choose another code.`,
      fieldErrors: { code: [TAKEN], members: ["Check the team."] },
    });
    await createFromStepThree();
    await screen.findByRole("dialog", { name: /step 1 of 3/ });
    const code = screen.getByLabelText(/Code/) as HTMLInputElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(code));
    expect(screen.getAllByText(`${TAKEN} Choose another code.`).length).toBeGreaterThan(0);

    await user.keyboard("X");
    expect(code.value).toBe("PL-1X");
    const dialog = screen.getByRole("dialog", { name: /step 1 of 3/ });
    expect(within(dialog).queryByText(`${TAKEN} Choose another code.`)).toBeNull();
    expect(within(dialog).queryByText(TAKEN)).toBeNull();
  });
});

describe("Admin → Integrations: removing Slack keeps focus on the card", () => {
  refuseFocusInsideInert();

  const TOGGLES = {
    taskAssigned: true,
    mention: true,
    statusChange: true,
    overdueReminder: true,
    gateOverride: true,
    announcements: false,
    dailyBrief: false,
    weeklyBrief: false,
  };
  const slack = (configured: boolean): OrgIntegrationDTO =>
    ({
      kind: "SLACK",
      configured,
      enabled: configured,
      webhookUrlMasked: configured ? "https://hooks.slack.com/…" : null,
      eventToggles: TOGGLES,
      updatedAt: null,
    }) as unknown as OrgIntegrationDTO;

  function view(configured: boolean) {
    return (
      <AdminIntegrationsView
        integrations={[slack(configured)]}
        microsoft={{ available: false } as never}
        microsoftSignIn={{ enabled: false } as never}
        emailAvailable={false}
        broadcastPolicy="ADMIN_ONLY"
      />
    );
  }

  beforeEach(() => {
    actions.deleteIntegration.mockReset();
    actions.deleteIntegration.mockResolvedValue({ ok: true, data: null });
  });

  it("lands on the card's address box, and stays there however late the card redraws", async () => {
    const { rerender } = render(view(true), { wrapper: Providers });
    act(() => screen.getByRole("button", { name: "Remove" }).focus());
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Remove Slack?" });
    act(() => (within(dialog).getAllByRole("button", { name: "Remove" }).pop() as HTMLElement).focus());
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.deleteIntegration).toHaveBeenCalledWith({ kind: "SLACK" });

    const box = screen.getByLabelText("Replace the address");
    await vi.waitFor(() => expect(document.activeElement).toBe(box));

    // The refresh that redraws the card arrives well after the old two-second wait gave up.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(document.activeElement).toBe(box);
    rerender(view(false));
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Webhook address"));
    expect(document.activeElement).not.toBe(document.body);
  });
});

// ---------------------------------------------------------------------------------------------
// Round ten (re-test, November 2026).
//
// 1. After saving a Slack or Teams address the Save button greyed out with focus on it, and the
//    next Tab skipped the address box. Focus now goes back to the card's address box.
// 2. Enter in the webhook address box did nothing; the box and its button are now one form.
// 3. New project and Add a member opened with focus on the dialog itself, so the first Tab landed
//    on Close. They now open in their first box.
// 4. New project's Next stayed grey until both dates were filled, with nothing saying so.
// 5. Admin → Disciplines: every "Edit" button was just "Edit" to a screen reader.
// ---------------------------------------------------------------------------------------------

describe("Admin → Integrations: saving an address", () => {
  const TOGGLES = {
    taskAssigned: true,
    mention: true,
    statusChange: true,
    overdueReminder: true,
    gateOverride: true,
    announcements: false,
    dailyBrief: false,
    weeklyBrief: false,
  };
  const slack = (configured: boolean): OrgIntegrationDTO =>
    ({
      kind: "SLACK",
      configured,
      enabled: configured,
      webhookUrlMasked: configured ? "https://hooks.slack.com/…" : null,
      eventToggles: TOGGLES,
      updatedAt: null,
    }) as unknown as OrgIntegrationDTO;
  const ADDRESS = "https://hooks.slack.com/services/T000/B000/XXXX";

  function view(configured: boolean) {
    return (
      <AdminIntegrationsView
        integrations={[slack(configured)]}
        microsoft={{ available: false } as never}
        microsoftSignIn={{ enabled: false } as never}
        emailAvailable={false}
        broadcastPolicy="ADMIN_ONLY"
      />
    );
  }

  beforeEach(() => {
    actions.saveIntegration.mockReset();
    actions.saveIntegration.mockResolvedValue({ ok: true, data: null });
  });

  it("pressing Replace address puts focus back on the address box, and Tab goes on from there", async () => {
    render(view(true), { wrapper: Providers });
    const box = screen.getByLabelText("Replace the address") as HTMLInputElement;
    await user.click(box);
    await user.keyboard(ADDRESS);
    act(() => screen.getByRole("button", { name: "Replace address" }).focus());
    await user.keyboard("{Enter}");

    expect(actions.saveIntegration).toHaveBeenCalledWith({ kind: "SLACK", webhookUrl: ADDRESS });
    await vi.waitFor(() => expect(box.value).toBe(""));
    expect(document.activeElement).toBe(box);
    // The emptied box's button is greyed out, so the next Tab is the first switch below it — from
    // the box, not from somewhere outside the card.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /Task assigned/ }));
  });

  it("the first save (Save address) lands on the address box too", async () => {
    render(view(false), { wrapper: Providers });
    const box = screen.getByLabelText("Webhook address") as HTMLInputElement;
    await user.click(box);
    await user.keyboard(ADDRESS);
    await user.click(screen.getByRole("button", { name: "Save address" }));
    await vi.waitFor(() => expect(box.value).toBe(""));
    expect(document.activeElement).toBe(box);
  });

  it("Enter in the address box saves it, once, however many times it is pressed", async () => {
    let finish: (value: unknown) => void = () => undefined;
    actions.saveIntegration.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    render(view(true), { wrapper: Providers });
    const box = screen.getByLabelText("Replace the address") as HTMLInputElement;
    await user.click(box);
    await user.keyboard(`${ADDRESS}{Enter}`);
    await user.keyboard("{Enter}");
    expect(actions.saveIntegration).toHaveBeenCalledTimes(1);
    expect(actions.saveIntegration).toHaveBeenCalledWith({ kind: "SLACK", webhookUrl: ADDRESS });

    await act(async () => finish({ ok: true, data: null }));
    await vi.waitFor(() => expect(box.value).toBe(""));
    expect(document.activeElement).toBe(box);
  });

  it("Enter in an empty address box sends nothing", async () => {
    render(view(true), { wrapper: Providers });
    await user.click(screen.getByLabelText("Replace the address"));
    await user.keyboard("{Enter}");
    await user.keyboard("   {Enter}");
    expect(actions.saveIntegration).not.toHaveBeenCalled();
  });
});

describe("Dialogs open in their first box", () => {
  it("New project: the cursor starts in Name, and the first Tab goes to Code, not Close", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    await user.keyboard("Pipe");
    expect(name.value).toBe("Pipe");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/Code/));
  });

  it("Add a member: the cursor starts in the Person search", async () => {
    render(<ProjectTeamTab project={PROJECT} canManage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ Add member" }));
    const dialog = screen.getByRole("dialog", { name: "Add a member" });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Person"));
    await user.keyboard("Ham");
    expect((within(dialog).getByLabelText("Person") as HTMLInputElement).value).toBe("Ham");
    expect(document.activeElement).not.toBe(within(dialog).getByRole("button", { name: "Close" }));
  });
});

describe("New project: a greyed-out Next says what it is waiting for", () => {
  it("names what is missing, marks the dates as needed, and goes once all four are filled", async () => {
    render(<NewProjectPage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ New project" }));
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    const reason = () => document.getElementById("new-project-next-reason");
    expect(reason()?.textContent).toBe(
      "Add a name, a code, a start date and a deadline to continue.",
    );
    expect(next.getAttribute("aria-describedby")).toBe("new-project-next-reason");

    const start = screen.getByLabelText("Start date") as HTMLInputElement;
    const deadline = screen.getByLabelText(/Deadline/) as HTMLInputElement;
    expect(start.required).toBe(true);
    expect(deadline.required).toBe(true);

    await user.keyboard("Pipeline");
    await user.tab();
    await user.keyboard("PL-1");
    expect(reason()?.textContent).toBe("Add a start date and a deadline to continue.");
    fireEvent.change(start, { target: { value: "2026-12-01" } });
    expect(reason()?.textContent).toBe("Add a deadline to continue.");
    fireEvent.change(deadline, { target: { value: "2027-06-30" } });
    expect(reason()).toBeNull();
    expect(next.disabled).toBe(false);
    expect(next.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("Admin → Disciplines: each Edit button says which discipline", () => {
  it("is named 'Edit <discipline>' on the phone cards and the desktop table alike", async () => {
    render(
      <AdminDisciplinesView
        disciplines={[
          { id: "d-mech", code: "MECH", name: "Mechanical", colorHex: "#1F6FEB", sortOrder: 1 },
          { id: "d-elec", code: "ELEC", name: "Electrical", colorHex: "#D29922", sortOrder: 2 },
        ]}
      />,
      { wrapper: Providers },
    );
    expect(screen.getAllByRole("button", { name: "Edit Mechanical" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit Electrical" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Edit Electrical" })[0]);
    expect(screen.getByRole("dialog", { name: "Edit Electrical" })).toBeTruthy();
  });
});

describe("Add a member never offers somebody already on the project", () => {
  // Round 11: Salma was already on the project in Mechanical, yet the people search offered her
  // like anyone else, and adding her again quietly rewrote her role and discipline.
  const TEAM = {
    ...PROJECT,
    members: [
      {
        id: "pm-u-2",
        userId: "u-2",
        userName: "Salma Al Harthy",
        userEmail: "salma@example.com",
        projectRole: "ENGINEER",
        disciplineId: "d-mech",
        disciplineCode: "MECH",
      },
    ],
  } as unknown as ProjectDTO;

  beforeEach(() => {
    actions.addMember.mockReset();
    actions.upsertMember.mockReset();
  });

  async function openSearch() {
    render(<ProjectTeamTab project={TEAM} canManage />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "+ Add member" }));
    await user.click(screen.getByLabelText("Person"));
    await user.keyboard("a");
    return screen.getByRole("dialog", { name: "Add a member" });
  }

  it("lists a current member as 'Already on this project', and pressing them picks nobody", async () => {
    const dialog = await openSearch();
    const salma = within(dialog).getByRole("button", { name: /Salma Al Harthy/ }) as HTMLButtonElement;
    expect(salma.textContent).toContain("Already on this project");
    expect(salma.disabled).toBe(true);

    await user.click(salma);
    expect(within(dialog).queryByRole("group", { name: "Person: Salma Al Harthy" })).toBeNull();
    expect(actions.addMember).not.toHaveBeenCalled();
    expect(actions.upsertMember).not.toHaveBeenCalled();
  });

  it("someone not on the project is still offered as usual, and added through addMember", async () => {
    actions.addMember.mockResolvedValue({ ok: true, data: null });
    const dialog = await openSearch();
    const hamed = within(dialog).getByRole("button", { name: /Hamed Al Busaidi/ }) as HTMLButtonElement;
    expect(hamed.textContent).not.toContain("Already on this project");
    expect(hamed.disabled).toBe(false);

    // The keyboard path from rounds 9–10 still holds: Tab from the search skips the member who
    // cannot be picked and lands on the first person who can.
    act(() => screen.getByLabelText("Person").focus());
    await user.tab();
    expect(document.activeElement).toBe(hamed);
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Person: Hamed Al Busaidi" }));

    await user.selectOptions(screen.getByLabelText("Discipline"), "d-mech");
    await user.click(within(dialog).getByRole("button", { name: "Add to project" }));
    await vi.waitFor(() => expect(actions.addMember).toHaveBeenCalledTimes(1));
    expect(actions.addMember).toHaveBeenCalledWith({
      projectId: "pr-1",
      userId: "u-3",
      projectRole: "ENGINEER",
      disciplineId: "d-mech",
    });
    expect(actions.upsertMember).not.toHaveBeenCalled();
  });

  it("a server refusal ('already on this project') is said once, under the Person box", async () => {
    // The list can be out of date (a colleague added them a moment ago); the server has the last word.
    const said = "Already on this project — change their role from the Members list.";
    actions.addMember.mockResolvedValue({
      ok: false,
      error: "Hamed Al Busaidi is already on this project.",
      fieldErrors: { userId: [said] },
    });
    const dialog = await openSearch();
    await user.click(within(dialog).getByRole("button", { name: /Hamed Al Busaidi/ }));
    await user.selectOptions(screen.getByLabelText("Discipline"), "d-mech");
    await user.click(within(dialog).getByRole("button", { name: "Add to project" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe(said);
    expect(screen.queryByText("Hamed Al Busaidi is already on this project.")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Add a member" })).toBeTruthy();
  });
});
