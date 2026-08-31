// The photograph on the public panel (sign in, create a workspace). Decorative only — the panel
// still reads correctly without it, which is why it simply disappears if the file can't be loaded.
// (An <Image> with onError has to be a client component; the gradient panel behind it stays
// server-rendered.)

"use client";

import Image from "next/image";
import { useState } from "react";

export function LoginHero() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <>
      <Image
        src="/login-hero.webp"
        alt=""
        fill
        priority
        sizes="(min-width: 768px) 45vw, 100vw"
        className="pointer-events-none object-cover"
        onError={() => setFailed(true)}
      />
      {/* Keeps the wordmark and tagline readable over the photograph. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--brand-ink)] via-[var(--brand-ink)]/40 to-transparent" />
    </>
  );
}
