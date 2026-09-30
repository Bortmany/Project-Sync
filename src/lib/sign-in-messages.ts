// The words a refused sign-in is answered with — in ONE place, for every door into the app.
//
// The password route (`POST /api/auth/login`) answers with it, and so does every refused "Sign in
// with Microsoft" (the callback sends the browser to `/login?microsoft=failed`, and the login page
// shows exactly this sentence). Wrong password, unknown address, deactivated account, a contractor
// whose access has ended, the wrong Microsoft company, an unlinked or differently-linked Microsoft
// account, a cancelled Microsoft screen, an expired or tampered attempt: one sentence, one status,
// no hint which. It lives in a file with no server imports so a client component may read it too.

/** What every refused sign-in says, whichever door it came through. Never retype it. */
export const SIGN_IN_REFUSED_MESSAGE = "Incorrect email or password.";
