// "Export" on a project's header: a two-item menu (PDF, PowerPoint) that downloads a status report.
//
// The file is fetched by the page and saved from a blob rather than followed as a link, so a refusal
// shows a plain-English line under the button instead of navigating away. Contractors never see it
// (the server answers "not found" to them anyway), and nothing renders while we do not yet know who
// is signed in, so there is no flash of a button that then disappears.

"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isExternalUser, useMe } from "@/components/hooks/use-api";
import { Spinner, useToast } from "@/components/ui";

type ReportFormat = "pdf" | "pptx";

const FORMATS: { format: ReportFormat; label: string; hint: string; title: string }[] = [
  {
    format: "pdf",
    label: "PDF",
    hint: "Best for printing or email",
    title: "Download as a PDF file",
  },
  {
    format: "pptx",
    label: "PowerPoint",
    hint: "Best for presenting in a meeting",
    title: "Download as a PowerPoint file (.pptx)",
  },
];

const MESSAGE_TOO_MANY = "You have exported a lot of reports just now. Please wait a minute.";
const MESSAGE_NOT_FOUND = "We could not find that project.";
const MESSAGE_OTHER = "We could not build that report. Please try again.";

const SLOW_AFTER_MS = 10_000;
const MAX_COOLDOWN_SEC = 60;

function fileNameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export function ExportMenu({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const me = useMe();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [slow, setSlow] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Close on a tap outside or Escape (focus goes back to the button).
  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus to the first item when the menu opens.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // Count the cooldown down one second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const download = useCallback(
    async (format: ReportFormat) => {
      setOpen(false);
      setError(null);
      setBusy(format);
      setSlow(false);
      const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/report?format=${format}`,
          { credentials: "same-origin" },
        );
        if (response.status === 429) {
          const wait = Number(response.headers.get("Retry-After"));
          const seconds = Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), MAX_COOLDOWN_SEC) : MAX_COOLDOWN_SEC;
          setCooldown(seconds);
          setError(MESSAGE_TOO_MANY);
          return;
        }
        if (response.status === 404) {
          setError(MESSAGE_NOT_FOUND);
          return;
        }
        if (!response.ok) {
          setError(MESSAGE_OTHER);
          return;
        }
        const blob = await response.blob();
        const name = fileNameFrom(
          response.headers.get("Content-Disposition"),
          `${projectCode}-status.${format}`,
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.show(
          format === "pdf"
            ? "Your PDF report is ready. Check your downloads."
            : "Your PowerPoint report is ready. Check your downloads.",
          "success",
        );
      } catch {
        setError(MESSAGE_OTHER);
      } finally {
        clearTimeout(slowTimer);
        setBusy(null);
        setSlow(false);
      }
    },
    [projectId, projectCode, toast],
  );

  if (me.isPending || !me.data || isExternalUser(me.data)) return null;

  const disabled = busy !== null || cooldown > 0;

  function onItemKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      itemRefs.current[(index + 1) % FORMATS.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      itemRefs.current[(index - 1 + FORMATS.length) % FORMATS.length]?.focus();
    }
  }

  return (
    <>
      <div ref={wrapRef} className="relative ml-auto sm:ml-0">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy !== null}
          title={
            cooldown > 0
              ? "You can export again in a moment."
              : "Download a status report for this project"
          }
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--brand-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] transition-colors hover:bg-[var(--page-bg)] disabled:cursor-not-allowed disabled:border-[var(--brand-gray)] disabled:text-[var(--brand-gray)] ${
            open ? "bg-[var(--page-bg)]" : ""
          } ${busy ? "min-w-[11rem]" : ""}`}
        >
          {busy ? (
            <>
              <Spinner size={16} />
              <span>{slow ? "Still working… big projects take a bit longer." : "Preparing your report…"}</span>
            </>
          ) : (
            <>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Export</span>
            </>
          )}
        </button>

        {open ? (
          <div
            role="menu"
            aria-label="Export a status report"
            className="absolute right-0 z-40 mt-2 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-white p-1 shadow-lg"
          >
            {FORMATS.map((item, index) => (
              <button
                key={item.format}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                title={item.title}
                onKeyDown={(event) => onItemKey(event, index)}
                onClick={() => void download(item.format)}
                className="flex min-h-11 w-full flex-col justify-center rounded-[var(--radius)] px-2 py-1 text-left hover:bg-[var(--page-bg)] focus:bg-[var(--page-bg)]"
              >
                <span className="text-sm font-semibold text-[var(--brand-ink)]">{item.label}</span>
                <span className="text-xs text-[var(--brand-text)]">{item.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="order-last flex w-full basis-full items-center justify-between gap-3 text-sm text-[var(--status-blocked)]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="min-h-11 shrink-0 px-2 text-sm font-semibold text-[var(--status-blocked)] underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
