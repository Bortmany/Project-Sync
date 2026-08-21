// The production boot guards: a weak secret or an unusable uploads folder must stop the app
// starting, and neither check may get in the way of development or the test run.
// The two halves run at different moments — the secret at import time (so it also covers the
// build), the uploads folder at server start only, because no volume is mounted during a build.

import { describe, expect, it } from "vitest";
import {
  bootProblems,
  dataDirProblems,
  MIN_SECRET_LENGTH,
  sessionSecretProblems,
} from "@/lib/boot-guards";

const GOOD_SECRET = "x".repeat(MIN_SECRET_LENGTH);
const writable = () => true;
const notWritable = () => false;

describe("bootProblems", () => {
  it("passes a production environment with a long secret and a writable data folder", () => {
    expect(
      bootProblems(
        { NODE_ENV: "production", SESSION_SECRET: GOOD_SECRET, DATA_DIR: "/data" },
        writable,
      ),
    ).toEqual([]);
  });

  it("refuses production without a SESSION_SECRET", () => {
    const problems = bootProblems({ NODE_ENV: "production", DATA_DIR: "/data" }, writable);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SESSION_SECRET");
  });

  it("refuses production with a secret shorter than 32 characters", () => {
    const problems = bootProblems(
      { NODE_ENV: "production", SESSION_SECRET: "x".repeat(MIN_SECRET_LENGTH - 1), DATA_DIR: "/data" },
      writable,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SESSION_SECRET");
  });

  it("refuses production when DATA_DIR is unset or blank", () => {
    for (const env of [
      { NODE_ENV: "production", SESSION_SECRET: GOOD_SECRET },
      { NODE_ENV: "production", SESSION_SECRET: GOOD_SECRET, DATA_DIR: "   " },
    ]) {
      const problems = bootProblems(env, writable);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("DATA_DIR");
    }
  });

  it("refuses production when DATA_DIR cannot be written to", () => {
    const problems = bootProblems(
      { NODE_ENV: "production", SESSION_SECRET: GOOD_SECRET, DATA_DIR: "/data" },
      notWritable,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("cannot be written to");
  });

  it("reports every problem at once, so one restart shows the whole list", () => {
    expect(bootProblems({ NODE_ENV: "production" }, notWritable)).toHaveLength(2);
  });

  it("never blocks development or the test run", () => {
    expect(bootProblems({ NODE_ENV: "development" }, notWritable)).toEqual([]);
    expect(bootProblems({ NODE_ENV: "test" }, notWritable)).toEqual([]);
  });
});

describe("the two halves run at different moments", () => {
  it("checks the session secret at import time, without ever touching the disk", () => {
    expect(sessionSecretProblems({ NODE_ENV: "production", SESSION_SECRET: GOOD_SECRET })).toEqual(
      [],
    );
    expect(sessionSecretProblems({ NODE_ENV: "production" })[0]).toContain("SESSION_SECRET");
  });

  it("never fails a production build over DATA_DIR — the volume is not mounted yet", () => {
    const buildEnv = {
      NODE_ENV: "production",
      SESSION_SECRET: GOOD_SECRET,
      DATA_DIR: "/dev/null/nope",
      NEXT_PHASE: "phase-production-build",
    };
    expect(dataDirProblems(buildEnv, notWritable)).toEqual([]);
    expect(bootProblems(buildEnv, notWritable)).toEqual([]);
  });

  it("still refuses a bad DATA_DIR when a real server starts", () => {
    const runtimeEnv = {
      NODE_ENV: "production",
      SESSION_SECRET: GOOD_SECRET,
      DATA_DIR: "/dev/null/nope",
    };
    const problems = dataDirProblems(runtimeEnv, notWritable);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("cannot be written to");
  });

  it("still refuses a missing SESSION_SECRET during a build", () => {
    const problems = bootProblems(
      { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" },
      notWritable,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SESSION_SECRET");
  });
});
