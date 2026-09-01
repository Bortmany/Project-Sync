// The photograph behind the landing page's hero. Decorative only.
//
// Exactly the pattern src/app/(auth)/login/login-hero.tsx uses, and for exactly the same reason:
// the hero is a server-rendered ink gradient with the picture laid on top, so a file that is
// missing, unreadable or slow simply is not there — the words stay white on the gradient and
// nobody ever sees a broken-image icon. `public/landing-hero.webp` is not in the repository yet;
// this page is finished and correct without it, and gains the photograph the day it is dropped in.
// (An <Image> with onError has to be a client component; everything around it stays on the server.)

"use client";

import Image from "next/image";
import { useState } from "react";

export function LandingHeroImage() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <Image
      src="/landing-hero.webp"
      alt=""
      fill
      // Deliberately NOT `priority` while the file is absent: preloading it would make every
      // visitor fetch a guaranteed 404 and log a console error for a picture that is not there.
      // Add `priority` when the owner drops the real file in — see docs/GO-LIVE.md.
      sizes="100vw"
      // Left of centre: the picture's dark side stays under the headline as the window narrows.
      className="pointer-events-none object-cover object-left"
      onError={() => setFailed(true)}
    />
  );
}
