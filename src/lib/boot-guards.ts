// Boot guards: production refuses to start with a weak session secret or an unusable uploads folder.
// Development and test are left alone so a fresh clone still runs with the values in .env.example.
//
// The two halves run at different moments on purpose:
//  - SESSION_SECRET is checked when src/lib/auth.ts is first imported, which includes `next build`
//    (the build renders pages, so it needs the same secret a running server needs).
//  - DATA_DIR and the uploads folder are checked at RUNTIME only, from src/instrumentation.ts.
//    The hosting volume is not mounted while the image is being built, so a build must never fail
//    on it. As a second belt, the disk check returns nothing during Next's production build phase.

import { accessSync, constants, mkdirSync } from "node:fs";
import path from "node:path";

export const MIN_SECRET_LENGTH = 32;

export type BootEnv = {
  NODE_ENV?: string;
  SESSION_SECRET?: string;
  DATA_DIR?: string;
  NEXT_PHASE?: string;
};

/** Next sets this while `next build` is running — no volume is mounted yet at that point. */
const BUILD_PHASE = "phase-production-build";

/** The session-secret half of the guards. Safe at import time, including during a build. */
export function sessionSecretProblems(env: BootEnv): string[] {
  if (env.NODE_ENV !== "production") return [];

  const secret = env.SESSION_SECRET ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) return [];

  return [
    `SESSION_SECRET is missing or too short. Set at least ${MIN_SECRET_LENGTH} characters, for example the output of: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
  ];
}

/**
 * The uploads-folder half of the guards. Runtime only — never during `next build`, where the
 * volume that holds uploads is not mounted yet.
 */
export function dataDirProblems(
  env: BootEnv,
  dataDirWritable: (dir: string) => boolean,
): string[] {
  if (env.NODE_ENV !== "production") return [];
  if (env.NEXT_PHASE === BUILD_PHASE) return [];

  const dataDir = env.DATA_DIR ?? "";
  if (dataDir.trim().length === 0) {
    return [
      "DATA_DIR is not set. Point it at the mounted volume where uploaded files are kept, for example /data.",
    ];
  }
  if (!dataDirWritable(dataDir)) {
    return [
      `DATA_DIR (${dataDir}) cannot be written to. Check the volume is mounted and the app owns the folder.`,
    ];
  }

  return [];
}

/**
 * Every problem that must stop a production *server* start, in plain English. Pure — the caller
 * says whether the uploads folder can actually be written, so this is testable without touching
 * disk. An empty array means the environment is fit to start.
 */
export function bootProblems(env: BootEnv, dataDirWritable: (dir: string) => boolean): string[] {
  return [...sessionSecretProblems(env), ...dataDirProblems(env, dataDirWritable)];
}

/** Creates the uploads folder if it is missing and reports whether it is writable. */
export function uploadsFolderWritable(dataDir: string): boolean {
  try {
    const dir = path.resolve(dataDir, "uploads");
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function refuse(problems: string[]): void {
  if (problems.length === 0) return;
  throw new Error(`Project Nexus cannot start in production:\n- ${problems.join("\n- ")}`);
}

/**
 * The import-time guard, called from src/lib/auth.ts. Everything server-side reaches that module,
 * so production can never serve a request — or finish a build — with a weak session secret.
 */
export function assertSessionSecret(env: BootEnv = process.env): void {
  refuse(sessionSecretProblems(env));
}

/**
 * The runtime guard, called from src/instrumentation.ts register(), which only runs when a server
 * actually starts. Checks both halves, so a running production server with a missing or unusable
 * DATA_DIR refuses to serve.
 */
export function assertBootEnv(env: BootEnv = process.env): void {
  refuse(bootProblems(env, uploadsFolderWritable));
}
