// The two doors into Ask Tielora: the project header's button and the dashboard's launcher card.
//
// Neither decides whether it should exist. The PAGE (a server component) asks
// askTieloraAvailable() / askTieloraProjects() and only mounts these when the answer is yes: key
// set, company switch on, an internal role (never a contractor), and — on the dashboard — at least
// one project. So there is no "disabled" look and no gap where they would have been.

"use client";

import { useId, useState } from "react";
import { AskTieloraPanel } from "@/components/ai/ask-tielora-panel";
import { SparkleIcon } from "@/components/shell/icons";
import { Button } from "@/components/ui";
import type { AskProject } from "@/server/services/ai-panel";

/** "Ask Tielora" in the project header: secondary, sparkle then words, 44px, before Export. */
export function AskTieloraProjectButton({ project }: { project: { id: string; code: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <Button
        variant="secondary"
        className="min-h-11 aria-expanded:bg-[var(--page-bg)]"
        title="Ask a question about this project"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <SparkleIcon size={16} />
        Ask Tielora
      </Button>
      {open ? (
        <AskTieloraPanel
          panelId={panelId}
          scope={{ kind: "project", id: project.id, code: project.code, name: project.name }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** The slim launcher card under the company news strip. */
export function AskTieloraDashboardCard({ projects }: { projects: AskProject[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section
      aria-label="Ask Tielora"
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center sm:gap-4"
    >
      <span className="hidden text-[var(--brand-accent)] sm:block">
        <SparkleIcon size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--brand-ink)]">
          <span className="text-[var(--brand-accent)] sm:hidden">
            <SparkleIcon size={20} />
          </span>
          Ask Tielora
        </h2>
        <p className="text-sm text-[var(--brand-text)]">
          Ask a question about your projects, like what is blocking them.
        </p>
      </div>
      <Button
        className="min-h-11 w-full sm:ml-auto sm:w-auto"
        title="Ask a question about your projects"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Ask a question
      </Button>
      {open ? (
        <AskTieloraPanel panelId={panelId} scope={{ kind: "dashboard", projects }} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  );
}
