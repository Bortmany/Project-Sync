// Words and addresses the Teams tab shares between the server and the browser. No imports on
// purpose: a client component may import this file without pulling any server code (crypto, the
// database, the Microsoft helpers) into the browser bundle.

/** The popup's last stop: hands the one-time code to the tab and closes. */
export const TEAMS_AUTH_END_PATH = "/teams/auth-end";

/** What the session routes say while the feature is dormant (HTTP 503). */
export const TEAMS_NOT_SET_UP = "Tielora in Teams is not set up on this Tielora.";

/** The one sentence shown for every failed Teams sign-in, whatever the reason. */
export const TEAMS_SIGN_IN_FAILED_MESSAGE =
  "We could not sign you in with Microsoft. Ask your Tielora administrator if this keeps happening.";
