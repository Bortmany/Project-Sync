// Your account → Download your data.
//
// The download is a plain GET that streams the file, so this could have been an <a>. It is a fetch
// instead for one reason: the refusal. "You have already downloaded your data today" is something
// the person should read on this page, not a page of JSON the browser opened instead of the file
// they asked for.

"use client";

import { useState } from "react";
import { Button, Card, ErrorBanner } from "@/components/ui";

type State = "IDLE" | "WORKING" | "DONE";

const GENERIC = "Couldn't prepare your download. Try again.";

export function AccountView() {
  const [state, setState] = useState<State>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function download() {
    setState("WORKING");
    setError(null);
    setRefusal(null);

    try {
      const response = await fetch("/api/account/export", { credentials: "same-origin" });

      if (response.status === 429) {
        const body = await response.json().catch(() => null);
        setRefusal(
          (body && typeof body.error === "string" && body.error) ||
            "You have already downloaded your data today. You can get another copy tomorrow.",
        );
        setState("IDLE");
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError((body && typeof body.error === "string" && body.error) || GENERIC);
        setState("IDLE");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tielora-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("DONE");
    } catch {
      setError(GENERIC);
      setState("IDLE");
    }
  }

  return (
    <Card title="Download your data">
      <div className="space-y-4">
        <p className="text-sm text-[var(--brand-text)]">
          A JSON file with your own comments, the tasks assigned to you, your notifications, your
          personal list, and your profile details. It doesn&rsquo;t include anything belonging to
          your company as a whole — for that, an administrator can use Admin &rarr; Data &amp;
          privacy.
        </p>

        {error ? <ErrorBanner message={error} onRetry={download} /> : null}

        {refusal ? (
          <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]">
            {refusal}
          </p>
        ) : (
          <Button loading={state === "WORKING"} onClick={download}>
            {state === "WORKING" ? "Preparing…" : "Download your data"}
          </Button>
        )}

        {state === "DONE" ? (
          <p className="text-xs text-[var(--brand-gray)]">
            Your download should have started. If it didn&rsquo;t, press the button again.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
