// The personal list: add a line, tick it off, throw it away. Private to the signed-in person — it
// is never shown to anyone else and never joins the audit trail.

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createPersonalTask,
  deletePersonalTask,
  togglePersonalTask,
} from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { PERSONAL_TASKS_KEY, usePersonalTasks } from "@/components/hooks/use-api";
import { CloseIcon } from "@/components/shell/icons";
import { Button, EmptyState, ErrorBanner, Input, SkeletonRows } from "@/components/ui";
import type { PersonalTaskDTO } from "@/lib/zod-schemas";

/** The longest line the server accepts (CreatePersonalTaskInput). */
const MAX_TITLE = 200;

function PersonalRow({ task }: { task: PersonalTaskDTO }) {
  const queryClient = useQueryClient();
  const { run, pending } = useAction();

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: PERSONAL_TASKS_KEY });
  }

  return (
    <div className="flex min-h-11 items-center gap-3 px-2 py-2 hover:bg-[var(--page-bg)]">
      <input
        type="checkbox"
        checked={task.done}
        disabled={pending}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onChange={() =>
          run(() => togglePersonalTask({ id: task.id }), {
            failure: "Couldn't update this item. Try again.",
            onSuccess: refresh,
          })
        }
        className="h-4 w-4 shrink-0 accent-[var(--brand-primary)]"
      />
      <span
        className={`min-w-0 flex-1 break-words text-sm ${
          task.done ? "text-[var(--brand-gray)] line-through" : "text-[var(--brand-ink)]"
        }`}
      >
        {task.title}
      </span>
      <button
        type="button"
        disabled={pending}
        aria-label={`Delete "${task.title}"`}
        title="Delete"
        onClick={() =>
          run(() => deletePersonalTask({ id: task.id }), {
            failure: "Couldn't delete this item. Try again.",
            onSuccess: refresh,
          })
        }
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--brand-gray)] transition-colors hover:bg-white hover:text-[var(--status-blocked)] disabled:cursor-not-allowed"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

export function PersonalListView() {
  const list = usePersonalTasks();
  const queryClient = useQueryClient();
  const { run, pending } = useAction();
  const [title, setTitle] = useState("");

  function add() {
    const trimmed = title.trim();
    if (trimmed.length === 0 || pending) return;
    run(() => createPersonalTask({ title: trimmed }), {
      failure: "Couldn't add that. Try again.",
      onSuccess: () => {
        setTitle("");
        void queryClient.invalidateQueries({ queryKey: PERSONAL_TASKS_KEY });
      },
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
        className="flex items-start gap-2"
      >
        <Input
          value={title}
          maxLength={MAX_TITLE}
          placeholder="Add a note to yourself"
          aria-label="Add a note to yourself"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" disabled={title.trim().length === 0} loading={pending}>
          Add
        </Button>
      </form>

      {list.isError ? (
        <ErrorBanner
          message="Couldn't load your list. Try refreshing the page."
          onRetry={() => void list.refetch()}
        />
      ) : list.isPending ? (
        <SkeletonRows rows={5} />
      ) : list.data.length === 0 ? (
        <EmptyState compact message="Nothing on your list yet. Add the first line above." />
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-white">
          {list.data.map((task) => (
            <PersonalRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
