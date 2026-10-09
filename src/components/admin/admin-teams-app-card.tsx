// Admin → Integrations: the "Microsoft Teams app" card. One button saves `tielora-teams-app.zip`
// (the same package for every company; it holds no password or secret), plus plain-English steps
// for adding it to Teams. Shown to an administrator only, and not at all while this Tielora has not
// set the Teams app up (the page decides; this component never asks).
//
// A company that has not switched on Sign in with Microsoft still sees the card, with a notice at
// the top: the package is harmless without it, but people cannot sign in inside Teams until then.

"use client";

import { useState } from "react";
import { Badge, Button, Card, useToast } from "@/components/ui";

const DOWNLOAD_PATH = "/api/teams/manifest";

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path
        d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AdminTeamsAppCard({ microsoftSignInOn }: { microsoftSignInOn: boolean }) {
  const { show } = useToast();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (preparing) return;
    setPreparing(true);
    setError(null);
    try {
      const response = await fetch(DOWNLOAD_PATH, { credentials: "same-origin" });
      if (response.status === 429) {
        setError("You have downloaded this a lot just now. Please wait a minute.");
        return;
      }
      if (!response.ok) {
        setError("We could not prepare the file. Please try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tielora-teams-app.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      show("Tielora for Teams is ready. Check your downloads.", "success");
    } catch {
      setError("We could not prepare the file. Please try again.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Card
      id="microsoft-teams-app"
      title="Microsoft Teams app"
      action={
        microsoftSignInOn ? (
          <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
            Ready
          </Badge>
        ) : (
          <Badge>Needs Microsoft sign-in</Badge>
        )
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-sm text-[var(--brand-text)]">
          Put Tielora inside Teams. Your people get a “Your day” tab in the Teams sidebar. Channel
          messages are set up separately, in the Teams channel card, and are not changed by this.
        </p>

        {!microsoftSignInOn ? (
          <p
            role="status"
            className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]"
          >
            People cannot sign in inside Teams until you switch on Sign in with Microsoft. Do that
            first, in the Microsoft 365 card.{" "}
            <a
              href="#microsoft-365"
              className="inline-flex min-h-11 items-center font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
            >
              Go to that card
            </a>
          </p>
        ) : null}

        <div>
          <Button
            type="button"
            onClick={() => void download()}
            loading={preparing}
            title="Save the Tielora app file to upload into Teams"
            className="min-h-11 w-full sm:w-auto sm:min-w-[15rem]"
          >
            {preparing ? (
              "Preparing…"
            ) : (
              <>
                <DownloadIcon />
                Download Tielora for Teams
              </>
            )}
          </Button>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-[var(--status-blocked)]">
              {error}
            </p>
          ) : null}
        </div>

        <p className="text-xs text-[var(--brand-text)]">
          This file is the same for everyone at your company. It contains no passwords or secrets.
        </p>

        <details className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)]">
          <summary
            title="Step-by-step instructions for adding Tielora to Teams"
            className="flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold text-[var(--brand-primary)]"
          >
            How to add it to Teams
          </summary>
          <div className="space-y-2 break-words px-3 pb-3 text-xs text-[var(--brand-text)]">
            <p>
              <span className="font-semibold">Just to try it (only for you):</span> In Teams choose
              Apps, then Manage your apps, then Upload an app, then Upload a custom app, and pick the
              file. If you do not see “Upload a custom app”, your Teams administrator has switched
              that off. Use the next route.
            </p>
            <p>
              <span className="font-semibold">For everybody at your company:</span> Your Teams
              administrator opens the Teams admin centre, then Teams apps, then Manage apps, then
              Upload new app, and picks the file. Optionally they add it to a setup policy so it
              appears pinned for everyone.
            </p>
            <p>
              <span className="font-semibold">First time in the tab:</span> Each person may see a
              Microsoft approval screen once. If it says it needs administrator approval, your
              Microsoft administrator approves Tielora once for the company.
            </p>
            <p>You will know it worked when Tielora appears in Teams with a tab called Your day.</p>
          </div>
        </details>
      </div>
    </Card>
  );
}
