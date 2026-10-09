// Ask Tielora: one question, one whole answer, nothing saved. The same panel is used on a project
// page (about that one project) and on the dashboard (about all of the person's projects, or one).
//
// THE EXTERNAL RULE: this component is only ever mounted by a page that the SERVER already decided
// may draw it (see src/server/services/ai-panel.ts). It never decides that itself and has no way to
// "show for a contractor": a contractor's page is rendered without it, not hidden with styling.
//
// Rules it keeps, from docs/specs/align-2026-10/ui-ask-tielora.md:
//  - the answer is printed as PLAIN TEXT only (a model can be tricked into writing a link or an
//    image address that leaks data), so there is no markdown, no link, no HTML anywhere below;
//  - every refusal sentence is the server's own, shown exactly as it arrives and never re-worded;
//  - one answer at a time, kept in browser memory only: closing the panel throws it away;
//  - Send is refused while an answer is loading, so a jumpy thumb cannot bill twice.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SparkleIcon } from "@/components/shell/icons";
import { Button, Select, Skeleton, Textarea } from "@/components/ui";
import { AiAnswerDTO } from "@/lib/zod-schemas";
import type { AskProject } from "@/server/services/ai-panel";

const MAX_CHARS = 500;
/** "Still thinking…" appears after this long; the server gives up at 25 seconds. */
const SLOW_AFTER_MS = 8_000;
/** The longest a rate-limit wait is ever shown for. */
const MAX_WAIT_SEC = 60;
const LAPTOP_QUERY = "(min-width: 1024px)";

const NOT_FOUND_SENTENCE = "I can't find that project.";
const CAP_PREFIX = "Your company has used its AI allowance for this month.";
const SWITCHED_OFF_SENTENCES = ["Ask Tielora is not switched on for your company.", "Ask Tielora is not set up."];
const OFFLINE = "Could not reach Tielora. Check your connection and try again.";
const GENERIC_FAILURE = "Ask Tielora could not answer just now. Try again in a minute.";

const PROJECT_STARTERS = [
  "What is blocking this project?",
  "What is late?",
  "What is the next gate waiting on?",
];
const DASHBOARD_STARTERS = [
  "What is blocked across my projects?",
  "What is late?",
  "Which project is furthest behind?",
];

export type AskScope =
  | { kind: "project"; id: string; code: string; name: string }
  | { kind: "dashboard"; projects: AskProject[] };

/** What the body shows when the last question did not produce an answer. */
type Notice = {
  /** Neutral = nothing is broken; error = something went wrong and a retry may help. */
  tone: "neutral" | "error";
  text: string;
  /** The administrator's sentence points at Admin → Billing, so the door is offered. */
  billingLink?: boolean;
  /** Which refusal this is, so the right controls are switched off. */
  kind: "cap" | "off" | "notFound" | "rate" | "retry";
};

type Answer = { answer: string; basedOn: string[] };

function label(project: AskProject): string {
  return `${project.code} · ${project.name}`;
}

function CloseMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Reads the server's sentence from a failed reply. Never invents wording of its own for it. */
async function serverSentence(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : null;
  } catch {
    return null;
  }
}

/** Sorts a failed reply into what the body shows. Exported so a test can pin every refusal. */
export function noticeFor(status: number, sentence: string | null, retryAfter: number): { notice: Notice; wait: number } {
  const text = sentence ?? GENERIC_FAILURE;
  if (status === 429) {
    const wait = Math.min(MAX_WAIT_SEC, Math.max(1, retryAfter || 10));
    return { notice: { tone: "neutral", text, kind: "rate" }, wait };
  }
  if (text.startsWith(CAP_PREFIX)) {
    return { notice: { tone: "neutral", text, kind: "cap", billingLink: text.includes("Admin → Billing") }, wait: 0 };
  }
  if (text === NOT_FOUND_SENTENCE) return { notice: { tone: "neutral", text, kind: "notFound" }, wait: 0 };
  if (SWITCHED_OFF_SENTENCES.includes(text)) return { notice: { tone: "neutral", text, kind: "off" }, wait: 0 };
  return { notice: { tone: "error", text, kind: "retry" }, wait: 0 };
}

export function AskTieloraPanel({
  scope,
  onClose,
  panelId,
}: {
  scope: AskScope;
  onClose: () => void;
  /** The id the opening button points at with aria-controls. */
  panelId?: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const boxId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [laptop, setLaptop] = useState(false);
  const [mac, setMac] = useState(false);
  const [question, setQuestion] = useState("");
  const [chosen, setChosen] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldProblem, setFieldProblem] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);

  const projectId = scope.kind === "project" ? scope.id : chosen || undefined;
  const dashboard = scope.kind === "dashboard";
  const chosenProject = scope.kind === "dashboard" ? scope.projects.find((project) => project.id === chosen) : undefined;
  const starters = scope.kind === "project" || chosenProject ? PROJECT_STARTERS : DASHBOARD_STARTERS;
  const locked = notice?.kind === "cap" || notice?.kind === "off";
  const blocked = waiting || locked || retryIn > 0;

  // Which frame we are in, whether this is a Mac (for the shortcut hint), and where focus goes first.
  useEffect(() => {
    const media = window.matchMedia(LAPTOP_QUERY);
    const apply = () => setLaptop(media.matches);
    apply();
    media.addEventListener("change", apply);
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (media.matches) boxRef.current?.focus();
    else panelRef.current?.focus();
    return () => {
      media.removeEventListener("change", apply);
      abortRef.current?.abort();
      opener?.focus();
    };
  }, []);

  // "Still thinking…" after a while.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  // The rate-limit countdown: Send comes back by itself.
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setTimeout(() => setRetryIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryIn]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setFieldProblem("Type a question first.");
        return;
      }
      if (trimmed.length > MAX_CHARS) {
        setFieldProblem("Keep your question under 500 characters.");
        return;
      }
      if (blocked) return;

      setFieldProblem(null);
      setNotice(null);
      setAnswer(null);
      setAsked(trimmed);
      setSlow(false);
      setWaiting(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({ question: trimmed, ...(projectId ? { projectId } : {}) }),
        });

        if (response.ok) {
          const body = (await response.json()) as { ok?: boolean; data?: unknown };
          const parsed = AiAnswerDTO.safeParse(body.data);
          if (body.ok && parsed.success) {
            setAnswer(parsed.data);
            setQuestion("");
            bodyRef.current?.scrollTo({ top: 0 });
            if (window.matchMedia(LAPTOP_QUERY).matches) boxRef.current?.focus();
            return;
          }
          setNotice({ tone: "error", text: GENERIC_FAILURE, kind: "retry" });
          return;
        }

        const sentence = await serverSentence(response);
        const { notice: next, wait } = noticeFor(
          response.status,
          sentence,
          Number(response.headers.get("Retry-After")),
        );
        setNotice(next);
        if (wait > 0) setRetryIn(wait);
        // The person's list may be out of date (a project they were taken off): fetch it afresh.
        if (next.kind === "notFound" && dashboard) router.refresh();
      } catch {
        // A closed panel aborts its own request: nothing to show, nobody to show it to.
        if (controller.signal.aborted) return;
        setNotice({ tone: "error", text: OFFLINE, kind: "retry" });
      } finally {
        if (!controller.signal.aborted) setWaiting(false);
      }
    },
    [blocked, dashboard, projectId, router],
  );

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    // On a phone the page behind is locked, so Tab stays inside the sheet.
    if (event.key === "Tab" && !laptop) {
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function pick(text: string) {
    setQuestion(text);
    setFieldProblem(null);
    boxRef.current?.focus();
  }

  const length = question.length;
  const sendHint = `Send your question (${mac ? "Cmd" : "Ctrl"}+Enter)`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--brand-ink)]/40 lg:pointer-events-none lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[420px] lg:justify-end lg:bg-transparent"
      onMouseDown={(event) => {
        // Tapping the dim area closes the sheet on a phone; on a laptop clicking the page does not.
        if (!laptop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal={laptop ? "false" : "true"}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="pointer-events-auto flex h-[92dvh] w-full max-w-xl flex-col rounded-t-[var(--radius)] bg-white pb-[env(safe-area-inset-bottom)] shadow-lg focus:outline-none motion-safe:animate-[ask-tielora-up_200ms_ease-out] lg:h-full lg:max-w-none lg:rounded-none lg:border-l lg:border-[var(--border)] lg:motion-safe:animate-[ask-tielora-in_200ms_ease-out]"
      >
        {/* Header: fixed, 56px. */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-[var(--brand-ink)]">
            <span className="text-[var(--brand-accent)]">
              <SparkleIcon size={18} />
            </span>
            Ask Tielora
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
          >
            <CloseMark />
          </button>
        </header>

        {/* Scope line: fixed. */}
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
          {scope.kind === "project" ? (
            <p className="break-words text-xs text-[var(--brand-text)]">
              Asking about {scope.code} · {scope.name}
            </p>
          ) : (
            <label className="block space-y-1">
              <span className="block text-xs font-semibold text-[var(--brand-ink)]">Ask about</span>
              <Select
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                title="Choose which of your projects the question covers"
                className="min-h-11 truncate"
              >
                <option value="">All my projects</option>
                {scope.projects.map((project) => (
                  <option key={project.id} value={project.id} title={label(project)}>
                    {label(project)}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>

        {/* Body: the only part that scrolls. A polite live region, so the answer is announced. */}
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
          aria-live="polite"
          aria-busy={waiting}
        >
          {asked !== null ? (
            <blockquote className="min-w-0 break-words border-l-4 border-[var(--border)] pl-3 text-sm text-[var(--brand-ink)]">
              {asked}
            </blockquote>
          ) : null}

          {waiting ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--brand-text)]">
                {slow ? "Still thinking… big projects take a moment." : "Reading your project…"}
              </p>
              <div className="space-y-2" aria-hidden="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[96%]" />
                <Skeleton className="h-4 w-[90%]" />
                <Skeleton className="h-4 w-[55%]" />
                <Skeleton className="mt-3 h-3 w-[40%]" />
              </div>
            </div>
          ) : null}

          {!waiting && notice ? <NoticeBox notice={notice} retryIn={retryIn} onRetry={() => void send(asked ?? question)} /> : null}

          {!waiting && answer ? (
            <div className="space-y-3">
              {/* Plain text only: React prints this as text, with no markdown, link or image. */}
              <p className="min-w-0 whitespace-pre-wrap break-words border-l-4 border-[var(--brand-accent)] pl-3 text-base text-[var(--brand-ink)]">
                {answer.answer}
              </p>
              {answer.basedOn.length > 0 ? (
                <p className="break-words text-xs text-[var(--brand-text)]">Based on: {answer.basedOn.join(", ")}</p>
              ) : null}
              <p className="text-xs font-semibold text-[var(--brand-text)]">
                Answers may be wrong. Check the task before you act.
              </p>
            </div>
          ) : null}

          {!waiting && !locked && (asked === null || answer) ? (
            <div className="space-y-2">
              {asked === null ? (
                <p className="text-sm text-[var(--brand-text)]">
                  What would you like to know? I read the live project, so answers are as fresh as your
                  team&rsquo;s last update.
                </p>
              ) : null}
              <h3 className="text-xs font-semibold text-[var(--brand-ink)]">
                {asked === null ? "Not sure where to start? Try one of these." : "Ask something else"}
              </h3>
              <ul className="space-y-2">
                {starters.map((starter) => (
                  <li key={starter}>
                    <button
                      type="button"
                      onClick={() => pick(starter)}
                      title="Put this question in the box"
                      className="min-h-11 w-full break-words rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-left text-sm text-[var(--brand-primary)] hover:bg-[var(--page-bg)]"
                    >
                      {starter}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Footer: fixed to the bottom. */}
        <form
          className="shrink-0 space-y-2 border-t border-[var(--border)] px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(question);
          }}
        >
          <label htmlFor={boxId} className="block text-sm font-semibold text-[var(--brand-ink)]">
            Ask about your projects
          </label>
          <Textarea
            id={boxId}
            ref={boxRef}
            value={question}
            maxLength={MAX_CHARS}
            disabled={locked}
            placeholder={
              dashboard && !chosenProject
                ? "For example: What is late across my projects?"
                : "For example: What is blocking this project?"
            }
            aria-invalid={fieldProblem ? true : undefined}
            aria-describedby={fieldProblem ? errorId : undefined}
            className="max-h-40 min-h-[88px] resize-none"
            onChange={(event) => {
              setQuestion(event.target.value);
              if (fieldProblem) setFieldProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send(question);
              }
            }}
          />
          <div className="flex items-start justify-between gap-3">
            <p id={errorId} role="alert" className="min-w-0 break-words text-xs text-[var(--status-blocked)]">
              {fieldProblem}
            </p>
            {length >= 450 ? (
              <p
                className="shrink-0 text-xs tabular-nums"
                style={{ color: length >= 490 ? "var(--status-blocked)" : "var(--brand-text)" }}
              >
                {length} / {MAX_CHARS}
              </p>
            ) : null}
          </div>
          <span className="sr-only" aria-live="polite">
            {length >= 480 ? `${MAX_CHARS - 480} characters left` : ""}
          </span>

          <div className="flex justify-end">
            <Button
              type="submit"
              title={sendHint}
              loading={waiting}
              disabled={blocked || !question.trim()}
              className="min-h-11 w-full min-w-[8rem] sm:w-auto"
            >
              {waiting ? "Asking…" : retryIn > 0 ? `Try again in ${retryIn} s` : "Send"}
            </Button>
          </div>

          <p className="break-words text-xs text-[var(--brand-gray)]">
            Your question and this project&rsquo;s details are sent to Anthropic to write the answer.{" "}
            <Link href="/privacy" className="inline-flex min-h-11 items-center underline">
              Privacy
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

/** Every refusal, in the server's own words. */
function NoticeBox({ notice, retryIn, onRetry }: { notice: Notice; retryIn: number; onRetry: () => void }) {
  const error = notice.tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={
        error
          ? "space-y-3 rounded-[var(--radius)] border border-[var(--status-blocked)] bg-white px-3 py-3 text-sm text-[var(--status-blocked)]"
          : "space-y-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] px-3 py-3 text-sm text-[var(--brand-text)]"
      }
    >
      <p className="min-w-0 break-words">{notice.text}</p>
      {notice.billingLink ? (
        <Link
          href="/admin/billing"
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--brand-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] hover:bg-[var(--page-bg)]"
        >
          Open Billing
        </Link>
      ) : null}
      {notice.kind === "retry" ? (
        <Button variant="secondary" className="min-h-11" onClick={onRetry} disabled={retryIn > 0}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
