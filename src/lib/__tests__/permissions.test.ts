// Authorisation tests: every role against every action, so nobody quietly gains a power they should not have.

import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  PERMISSION_MATRIX,
  assertCan,
  can,
  type Action,
  type Actor,
  type PermissionContext,
} from "@/lib/permissions";

const PROJECT = "proj-1";
const OTHER_PROJECT = "proj-2";
const MECH = "disc-mech";
const ELEC = "disc-elec";

const ALL_ACTIONS: Action[] = [
  "CREATE_PROJECT",
  "EDIT_PROJECT",
  "DELETE_PROJECT",
  "MANAGE_MEMBERS",
  "MANAGE_PROJECT_DISCIPLINES",
  "CREATE_MAIN_TASK",
  "EDIT_MAIN_TASK",
  "DELETE_MAIN_TASK",
  "OVERRIDE_MAIN_TASK_STATUS",
  "CREATE_DISCIPLINE_TASK",
  "EDIT_DISCIPLINE_TASK",
  "ASSIGN_DISCIPLINE_TASK",
  "UPDATE_DISCIPLINE_TASK_STATUS",
  "COMPLETE_DISCIPLINE_TASK",
  "UPLOAD_DOCUMENT",
  "DELETE_DOCUMENT",
  "COMMENT",
  "MANAGE_USERS",
  "MANAGE_DISCIPLINES",
  "VIEW_PROJECT",
];

const admin: Actor = { userId: "u-admin", role: "ADMIN", memberships: [] };

const pm: Actor = {
  userId: "u-pm",
  role: "PROJECT_MANAGER",
  memberships: [{ projectId: PROJECT, projectRole: "PROJECT_MANAGER" }],
};

const lead: Actor = {
  userId: "u-lead",
  role: "DISCIPLINE_LEAD",
  memberships: [{ projectId: PROJECT, projectRole: "DISCIPLINE_LEAD", disciplineId: MECH }],
};

const engineer: Actor = {
  userId: "u-eng",
  role: "ENGINEER",
  memberships: [{ projectId: PROJECT, projectRole: "ENGINEER", disciplineId: MECH }],
};

const outsider: Actor = { userId: "u-out", role: "ENGINEER", memberships: [] };

/** ctx used for the table test: own project, own discipline, own assignment. */
const ownCtx: PermissionContext = { projectId: PROJECT, disciplineId: MECH };

describe("admin", () => {
  it("may do everything, in any project, member or not", () => {
    for (const action of ALL_ACTIONS) {
      expect(can(admin, action, { projectId: OTHER_PROJECT })).toBe(true);
    }
  });
});

describe("project manager", () => {
  const allowedInOwnProject: Action[] = ALL_ACTIONS.filter(
    (action) => action !== "MANAGE_USERS" && action !== "MANAGE_DISCIPLINES",
  );

  it("may run everything inside their own project", () => {
    for (const action of allowedInOwnProject) {
      expect({ action, allowed: can(pm, action, { ...ownCtx, assigneeId: "someone-else" }) }).toEqual({
        action,
        allowed: true,
      });
    }
  });

  it("may never manage users or disciplines", () => {
    expect(can(pm, "MANAGE_USERS", ownCtx)).toBe(false);
    expect(can(pm, "MANAGE_DISCIPLINES", ownCtx)).toBe(false);
  });

  it("may not touch a project they do not belong to", () => {
    for (const action of allowedInOwnProject.filter((a) => a !== "CREATE_PROJECT")) {
      expect({ action, allowed: can(pm, action, { projectId: OTHER_PROJECT }) }).toEqual({
        action,
        allowed: false,
      });
    }
  });

  it("may start a new project", () => {
    expect(can(pm, "CREATE_PROJECT", {})).toBe(true);
  });
});

describe("discipline lead", () => {
  const allowed: Action[] = [
    "VIEW_PROJECT",
    "COMMENT",
    "UPLOAD_DOCUMENT",
    "ASSIGN_DISCIPLINE_TASK",
    "UPDATE_DISCIPLINE_TASK_STATUS",
    "COMPLETE_DISCIPLINE_TASK",
  ];

  it("may do their discipline's work inside their project", () => {
    for (const action of allowed) {
      expect({ action, allowed: can(lead, action, ownCtx) }).toEqual({ action, allowed: true });
    }
  });

  it("may not do anything else", () => {
    for (const action of ALL_ACTIONS.filter((a) => !allowed.includes(a))) {
      expect({ action, allowed: can(lead, action, ownCtx) }).toEqual({ action, allowed: false });
    }
  });

  it("may not assign or complete work in another discipline", () => {
    expect(can(lead, "ASSIGN_DISCIPLINE_TASK", { projectId: PROJECT, disciplineId: ELEC })).toBe(false);
    expect(can(lead, "COMPLETE_DISCIPLINE_TASK", { projectId: PROJECT, disciplineId: ELEC })).toBe(false);
  });

  it("may not work in a project they do not belong to", () => {
    expect(can(lead, "VIEW_PROJECT", { projectId: OTHER_PROJECT })).toBe(false);
    expect(can(lead, "ASSIGN_DISCIPLINE_TASK", { projectId: OTHER_PROJECT, disciplineId: MECH })).toBe(
      false,
    );
  });
});

describe("engineer", () => {
  const ownTask: PermissionContext = { projectId: PROJECT, disciplineId: MECH, assigneeId: "u-eng" };
  const someoneElsesTask: PermissionContext = {
    projectId: PROJECT,
    disciplineId: MECH,
    assigneeId: "u-other",
  };

  it("may view and comment on their project", () => {
    expect(can(engineer, "VIEW_PROJECT", { projectId: PROJECT })).toBe(true);
    expect(can(engineer, "COMMENT", { projectId: PROJECT })).toBe(true);
  });

  it("may update, complete and upload on a task assigned to them", () => {
    expect(can(engineer, "UPDATE_DISCIPLINE_TASK_STATUS", ownTask)).toBe(true);
    expect(can(engineer, "COMPLETE_DISCIPLINE_TASK", ownTask)).toBe(true);
    expect(can(engineer, "UPLOAD_DOCUMENT", ownTask)).toBe(true);
  });

  it("may not touch a task assigned to somebody else", () => {
    expect(can(engineer, "UPDATE_DISCIPLINE_TASK_STATUS", someoneElsesTask)).toBe(false);
    expect(can(engineer, "COMPLETE_DISCIPLINE_TASK", someoneElsesTask)).toBe(false);
    expect(can(engineer, "UPLOAD_DOCUMENT", someoneElsesTask)).toBe(false);
  });

  it("may not touch a task with no assignee at all", () => {
    expect(can(engineer, "COMPLETE_DISCIPLINE_TASK", { projectId: PROJECT })).toBe(false);
  });

  it("may not manage anything", () => {
    const forbidden: Action[] = ALL_ACTIONS.filter(
      (action) =>
        !["VIEW_PROJECT", "COMMENT", "UPDATE_DISCIPLINE_TASK_STATUS", "COMPLETE_DISCIPLINE_TASK", "UPLOAD_DOCUMENT"].includes(
          action,
        ),
    );
    for (const action of forbidden) {
      expect({ action, allowed: can(engineer, action, ownTask) }).toEqual({ action, allowed: false });
    }
  });
});

describe("non-member", () => {
  it("cannot even view the project", () => {
    expect(can(outsider, "VIEW_PROJECT", { projectId: PROJECT })).toBe(false);
  });

  it("is denied every action on that project", () => {
    for (const action of ALL_ACTIONS) {
      expect({ action, allowed: can(outsider, action, { projectId: PROJECT, assigneeId: "u-out" }) }).toEqual(
        { action, allowed: false },
      );
    }
  });
});

describe("the project role always wins inside a project", () => {
  it("treats an engineer who manages a project as a project manager there", () => {
    const actor: Actor = {
      userId: "u-mixed",
      role: "ENGINEER",
      memberships: [{ projectId: PROJECT, projectRole: "PROJECT_MANAGER" }],
    };
    expect(can(actor, "CREATE_MAIN_TASK", { projectId: PROJECT })).toBe(true);
    expect(can(actor, "MANAGE_USERS", { projectId: PROJECT })).toBe(false);
  });

  it("restricts a global project manager added to a project as an engineer", () => {
    const actor: Actor = {
      userId: "u-demoted",
      role: "PROJECT_MANAGER",
      memberships: [{ projectId: PROJECT, projectRole: "ENGINEER", disciplineId: MECH }],
    };
    expect(can(actor, "OVERRIDE_MAIN_TASK_STATUS", { projectId: PROJECT })).toBe(false);
    expect(can(actor, "DELETE_PROJECT", { projectId: PROJECT })).toBe(false);
    expect(can(actor, "MANAGE_MEMBERS", { projectId: PROJECT })).toBe(false);
    // Their own assigned work still behaves like an engineer's.
    expect(
      can(actor, "COMPLETE_DISCIPLINE_TASK", { projectId: PROJECT, assigneeId: "u-demoted" }),
    ).toBe(true);
  });
});

/**
 * The whole matrix in one place: every case × every action, with the allowed set written out.
 * The tests above read like sentences; this one is the exhaustive backstop — if a new action is
 * added to the Action union, ALL_ACTIONS has to grow and every case below has to say yes or no to
 * it, so nobody can quietly inherit a power by adding an entry to a list in permissions.ts.
 */
type MatrixCase = {
  who: string;
  actor: Actor;
  ctx: PermissionContext;
  allowed: Action[];
};

const EVERYTHING_BUT_ADMIN_ONLY: Action[] = ALL_ACTIONS.filter(
  (action) => action !== "MANAGE_USERS" && action !== "MANAGE_DISCIPLINES",
);
const MEMBER_ONLY: Action[] = ["VIEW_PROJECT", "COMMENT"];
const LEAD_IN_OWN_DISCIPLINE: Action[] = [
  ...MEMBER_ONLY,
  "UPLOAD_DOCUMENT",
  "ASSIGN_DISCIPLINE_TASK",
  "UPDATE_DISCIPLINE_TASK_STATUS",
  "COMPLETE_DISCIPLINE_TASK",
];
const ENGINEER_ON_OWN_TASK: Action[] = [
  ...MEMBER_ONLY,
  "UPDATE_DISCIPLINE_TASK_STATUS",
  "COMPLETE_DISCIPLINE_TASK",
  "UPLOAD_DOCUMENT",
];

const MATRIX: MatrixCase[] = [
  {
    who: "an administrator, on a project they are not even a member of",
    actor: admin,
    ctx: { projectId: OTHER_PROJECT, disciplineId: ELEC, assigneeId: "somebody-else" },
    allowed: ALL_ACTIONS,
  },
  {
    who: "a project manager inside their own project",
    actor: pm,
    ctx: { ...ownCtx, assigneeId: "somebody-else" },
    allowed: EVERYTHING_BUT_ADMIN_ONLY,
  },
  {
    who: "a project manager looking at a project they are not on",
    actor: pm,
    ctx: { projectId: OTHER_PROJECT, disciplineId: MECH, assigneeId: "u-pm" },
    allowed: ["CREATE_PROJECT"],
  },
  {
    who: "a discipline lead, in their own discipline",
    actor: lead,
    ctx: { projectId: PROJECT, disciplineId: MECH },
    allowed: LEAD_IN_OWN_DISCIPLINE,
  },
  {
    who: "a discipline lead, looking at another discipline's work",
    actor: lead,
    ctx: { projectId: PROJECT, disciplineId: ELEC, assigneeId: "u-lead" },
    allowed: [...MEMBER_ONLY, "UPLOAD_DOCUMENT"],
  },
  {
    who: "a discipline lead whose membership carries no discipline at all",
    actor: {
      userId: "u-lead-nodisc",
      role: "DISCIPLINE_LEAD",
      memberships: [{ projectId: PROJECT, projectRole: "DISCIPLINE_LEAD", disciplineId: null }],
    },
    ctx: { projectId: PROJECT, disciplineId: MECH },
    allowed: [...MEMBER_ONLY, "UPLOAD_DOCUMENT"],
  },
  {
    who: "an engineer on a task assigned to them",
    actor: engineer,
    ctx: { projectId: PROJECT, disciplineId: MECH, assigneeId: "u-eng" },
    allowed: ENGINEER_ON_OWN_TASK,
  },
  {
    who: "an engineer on a colleague's task",
    actor: engineer,
    ctx: { projectId: PROJECT, disciplineId: MECH, assigneeId: "u-someone-else" },
    allowed: MEMBER_ONLY,
  },
  {
    who: "a global engineer who runs this particular project",
    actor: {
      userId: "u-eng-pm",
      role: "ENGINEER",
      memberships: [{ projectId: PROJECT, projectRole: "PROJECT_MANAGER" }],
    },
    ctx: { ...ownCtx, assigneeId: "somebody-else" },
    // No CREATE_PROJECT: starting a project is a global power, and globally they are an engineer.
    allowed: EVERYTHING_BUT_ADMIN_ONLY.filter((action) => action !== "CREATE_PROJECT"),
  },
  {
    who: "a global project manager who joined this project as an engineer",
    actor: {
      userId: "u-pm-eng",
      role: "PROJECT_MANAGER",
      memberships: [{ projectId: PROJECT, projectRole: "ENGINEER", disciplineId: MECH }],
    },
    ctx: { projectId: PROJECT, disciplineId: MECH, assigneeId: "u-pm-eng" },
    allowed: [...ENGINEER_ON_OWN_TASK, "CREATE_PROJECT"],
  },
  {
    who: "a global project manager who joined this project as a discipline lead",
    actor: {
      userId: "u-pm-lead",
      role: "PROJECT_MANAGER",
      memberships: [{ projectId: PROJECT, projectRole: "DISCIPLINE_LEAD", disciplineId: MECH }],
    },
    ctx: { projectId: PROJECT, disciplineId: MECH },
    allowed: [...LEAD_IN_OWN_DISCIPLINE, "CREATE_PROJECT"],
  },
  {
    who: "somebody who is on no project at all",
    actor: outsider,
    ctx: { projectId: PROJECT, disciplineId: MECH, assigneeId: "u-out" },
    allowed: [],
  },
  {
    who: "anybody at all, with no project named",
    actor: engineer,
    ctx: {},
    allowed: [],
  },
];

describe("the whole permission matrix", () => {
  for (const testCase of MATRIX) {
    it(`says exactly what ${testCase.who} may do`, () => {
      const answers = ALL_ACTIONS.map((action) => ({
        action,
        allowed: can(testCase.actor, action, testCase.ctx),
      }));
      const expected = ALL_ACTIONS.map((action) => ({
        action,
        allowed: testCase.allowed.includes(action),
      }));
      expect(answers).toEqual(expected);
    });
  }

  it("covers every action in the union — a new action cannot slip past the table", () => {
    // ALL_ACTIONS is hand-written; this keeps it honest against the shipped matrix map.
    const fromMatrix = new Set<Action>([
      ...PERMISSION_MATRIX.ADMIN.always,
      ...PERMISSION_MATRIX.ADMIN.conditional,
    ]);
    expect([...fromMatrix].sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it("keeps the UI hint map inside what the server would actually allow", () => {
    for (const [role, hints] of Object.entries(PERMISSION_MATRIX)) {
      for (const action of hints.always) {
        const actor: Actor = { userId: "u-hint", role: role as Actor["role"], memberships: [] };
        expect({ role, action, allowed: can(actor, action, { projectId: PROJECT }) }).toEqual({
          role,
          action,
          allowed: true,
        });
      }
    }
  });
});

describe("assertCan", () => {
  it("stays quiet when the answer is yes", () => {
    expect(() => assertCan(admin, "DELETE_PROJECT", { projectId: PROJECT })).not.toThrow();
  });

  it("throws a typed error with plain-English wording when the answer is no", () => {
    try {
      assertCan(engineer, "DELETE_PROJECT", { projectId: PROJECT });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).action).toBe("DELETE_PROJECT");
      expect((error as ForbiddenError).message).toBe("You do not have permission to do that.");
    }
  });
});
