// CommentComposer — the box at the top of a thread. Typing "@" opens a list of the project's people;
// picking one drops "@Name" into the text and quietly remembers who that was, so the server can check
// the mention and notify them.

"use client";

import { useMemo, useRef, useState } from "react";
import { createComment } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { Avatar, Button, ErrorBanner, Textarea } from "@/components/ui";

/** Someone who may be mentioned here: a member of this comment's project. */
export type Mentionable = { userId: string; userName: string };

/** How many people the mention popover shows at once. */
const MENTION_ROWS = 6;

/** The "@word" being typed just before the cursor, if there is one. */
function mentionQuery(text: string, cursor: number): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!match) return null;
  return { query: match[1], start: before.length - match[1].length - 1 };
}

export function CommentComposer({
  mainTaskId,
  disciplineTaskId,
  mentionable,
  onPosted,
  placeholder = "Add a comment…",
}: {
  mainTaskId?: string;
  disciplineTaskId?: string;
  mentionable: Mentionable[];
  onPosted: () => void;
  placeholder?: string;
}) {
  const { run, pending, error } = useAction();
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo(() => {
    if (!mention) return [];
    const needle = mention.query.toLowerCase();
    return mentionable
      .filter((person) => person.userName.toLowerCase().includes(needle))
      .slice(0, MENTION_ROWS);
  }, [mention, mentionable]);

  function grow(field: HTMLTextAreaElement) {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 240)}px`;
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    fieldRef.current = field;
    setBody(field.value);
    setMention(mentionQuery(field.value, field.selectionStart ?? field.value.length));
    setHighlighted(0);
    grow(field);
  }

  function choose(person: Mentionable) {
    const field = fieldRef.current;
    if (!field || !mention) return;

    const cursor = field.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.start)}@${person.userName} ${body.slice(cursor)}`;
    const caret = mention.start + person.userName.length + 2;

    setBody(next);
    setPicked((current) =>
      current.some((entry) => entry.userId === person.userId) ? current : [...current, person],
    );
    setMention(null);

    // Put the cursor straight after the inserted name so typing carries on naturally.
    window.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
      grow(field);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || matches.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(matches[highlighted]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMention(null);
    }
  }

  function post() {
    const text = body.trim();
    if (!text) return;

    // Only the names still written in the comment count as mentions.
    const mentions = picked
      .filter((person) => text.includes(`@${person.userName}`))
      .map((person) => person.userId);

    run(
      () =>
        createComment({
          body: text,
          mainTaskId: mainTaskId ?? null,
          disciplineTaskId: disciplineTaskId ?? null,
          mentions,
        }),
      {
        success: "Comment posted.",
        failure: "Couldn't post this comment. Try again.",
        onSuccess: () => {
          setBody("");
          setPicked([]);
          setMention(null);
          if (fieldRef.current) fieldRef.current.style.height = "auto";
          onPosted();
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      {error ? <ErrorBanner message={error} /> : null}

      <div className="relative">
        <Textarea
          value={body}
          placeholder={placeholder}
          aria-label="Add a comment"
          onChange={handleChange}
          onFocus={(event) => {
            fieldRef.current = event.currentTarget;
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setMention(null), 150)}
        />

        {mention && matches.length > 0 ? (
          <ul
            className="absolute z-20 mt-1 w-64 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-lg"
            role="listbox"
            aria-label="People you can mention"
          >
            {matches.map((person, index) => (
              <li key={person.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    index === highlighted ? "bg-[var(--page-bg)]" : "bg-white"
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(person)}
                >
                  <Avatar name={person.userName} size={24} />
                  <span className="text-[var(--brand-ink)]">{person.userName}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--brand-gray)]">
          Type @ to mention someone on this project.
        </p>
        <Button loading={pending} disabled={body.trim().length === 0} onClick={post}>
          Post
        </Button>
      </div>
    </div>
  );
}
