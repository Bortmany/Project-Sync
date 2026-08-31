// CommentComposer — the box at the top of a thread. Typing "@" opens a list of the project's people
// and its departments; picking one drops "@Name" into the text and quietly remembers who that was,
// so the server can check the mention and notify them. A department mention reaches everyone in that
// department on this project.

"use client";

import { useMemo, useRef, useState } from "react";
import { createComment } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { DisciplinesIcon } from "@/components/shell/icons";
import { Avatar, Button, ErrorBanner, Textarea } from "@/components/ui";

/** Someone who may be mentioned here: a member of this comment's project. */
export type Mentionable = { userId: string; userName: string };

/** A department that may be mentioned here: a discipline on this comment's project. */
export type MentionableDepartment = { id: string; name: string; colorHex: string };

/** One row of the popover. People come first, departments after them, in one flat list. */
type MentionRow =
  | { kind: "person"; key: string; name: string; person: Mentionable }
  | { kind: "department"; key: string; name: string; department: MentionableDepartment };

/** How many rows the mention popover shows at once — people and departments together. */
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
  departments = [],
  onPosted,
  placeholder = "Add a comment…",
}: {
  mainTaskId?: string;
  disciplineTaskId?: string;
  mentionable: Mentionable[];
  departments?: MentionableDepartment[];
  onPosted: () => void;
  placeholder?: string;
}) {
  const { run, pending, error } = useAction();
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [pickedDepartments, setPickedDepartments] = useState<MentionableDepartment[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo<MentionRow[]>(() => {
    if (!mention) return [];
    const needle = mention.query.toLowerCase();

    const people: MentionRow[] = mentionable
      .filter((person) => person.userName.toLowerCase().includes(needle))
      .map((person) => ({
        kind: "person",
        key: `person-${person.userId}`,
        name: person.userName,
        person,
      }));

    const groups: MentionRow[] = departments
      .filter((department) => department.name.toLowerCase().includes(needle))
      .map((department) => ({
        kind: "department",
        key: `department-${department.id}`,
        name: department.name,
        department,
      }));

    // One flat list, people first: the arrow keys never have to know which kind a row is.
    return [...people, ...groups].slice(0, MENTION_ROWS);
  }, [mention, mentionable, departments]);

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

  function choose(row: MentionRow) {
    const field = fieldRef.current;
    if (!field || !mention) return;

    const cursor = field.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.start)}@${row.name} ${body.slice(cursor)}`;
    const caret = mention.start + row.name.length + 2;

    setBody(next);
    if (row.kind === "person") {
      setPicked((current) =>
        current.some((entry) => entry.userId === row.person.userId)
          ? current
          : [...current, row.person],
      );
    } else {
      setPickedDepartments((current) =>
        current.some((entry) => entry.id === row.department.id)
          ? current
          : [...current, row.department],
      );
    }
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

    // Only the names still written in the comment count as mentions — people and departments alike.
    const mentions = picked
      .filter((person) => text.includes(`@${person.userName}`))
      .map((person) => person.userId);
    const disciplineMentions = pickedDepartments
      .filter((department) => text.includes(`@${department.name}`))
      .map((department) => department.id);

    run(
      () =>
        createComment({
          body: text,
          mainTaskId: mainTaskId ?? null,
          disciplineTaskId: disciplineTaskId ?? null,
          mentions,
          disciplineMentions,
        }),
      {
        success: "Comment posted.",
        failure: "Couldn't post this comment. Try again.",
        onSuccess: () => {
          setBody("");
          setPicked([]);
          setPickedDepartments([]);
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
            aria-label={
              departments.length > 0
                ? "People and departments you can mention"
                : "People you can mention"
            }
          >
            {matches.map((row, index) => (
              <li key={row.key}>
                {/* The group heading sits above the first department, and only when there is one. */}
                {row.kind === "department" && matches[index - 1]?.kind !== "department" ? (
                  <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                    Departments
                  </p>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    index === highlighted ? "bg-[var(--page-bg)]" : "bg-white"
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row)}
                >
                  {row.kind === "person" ? (
                    <Avatar name={row.name} size={24} />
                  ) : (
                    <DisciplinesIcon size={18} className="text-[var(--brand-gray)]" />
                  )}
                  <span className="text-[var(--brand-ink)]">{row.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--brand-gray)]">
          {departments.length > 0
            ? "Type @ to mention someone, or @ a department, on this project."
            : "Type @ to mention someone on this project."}
        </p>
        <Button loading={pending} disabled={body.trim().length === 0} onClick={post}>
          Post
        </Button>
      </div>
    </div>
  );
}
