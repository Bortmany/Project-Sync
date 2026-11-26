// One place for calling a server action from the UI: pending state, field errors, toasts.

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/ui";
import type { ActionResult } from "@/lib/zod-schemas";

type RunOptions<T> = {
  /** Toast shown when the action succeeds. */
  success?: string;
  /** Message shown in the form's banner if the server sends no better one. */
  failure: string;
  onSuccess?: (data: T) => void;
  /**
   * The fields this form shows an error under. When a refusal is entirely about those fields (a
   * duplicate email, a taken code) it is said once, under the field — no banner, no toast. A
   * refusal naming any other field, or none, still gets the banner and toast as before.
   */
  shownOnFields?: readonly string[];
  /**
   * Called with the fields a refusal names, before the screen redraws with them. A form spread over
   * steps uses it to go back to the step that holds the field, so the error is shown — and focus
   * lands — on a box the person can see (New project's taken code, refused on step 3).
   */
  onRefused?: (fieldErrors: Record<string, string[]>) => void;
};

/** True when every field a refusal names is one the form shows its own error under. */
export function refusalIsOnShownFields(
  fieldErrors: Record<string, string[]> | undefined,
  shownOnFields: readonly string[] | undefined,
): boolean {
  if (!fieldErrors || !shownOnFields) return false;
  const named = Object.keys(fieldErrors).filter((key) => (fieldErrors[key]?.length ?? 0) > 0);
  return named.length > 0 && named.every((key) => shownOnFields.includes(key));
}

export function useAction() {
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  // Where the form was sent from (its dialog, form or card), and a count of refusals that named a
  // field. Each such refusal moves focus to the first box marked invalid in that place, so a
  // keyboard or screen-reader user lands on the box to fix rather than on a button that was pressed.
  const scopeRef = useRef<Element | null>(null);
  const [fieldRefusals, setFieldRefusals] = useState(0);

  useEffect(() => {
    if (fieldRefusals === 0) return;
    const scope = scopeRef.current?.isConnected ? scopeRef.current : document.body;
    scope.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldRefusals]);

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  // A refusal under a field is about what was in the box when it was sent. Once the person changes
  // that box it no longer applies, so the red line goes — it must not sit under an emptied box.
  // Every form calls this from the box's change handler; the next refusal shows it again.
  // The banner alone, for a form whose banner said the same thing as a field that has now changed.
  const clearError = useCallback(() => setError(null), []);

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const run = useCallback(
    <T,>(work: () => Promise<ActionResult<T>>, options: RunOptions<T>) => {
      setError(null);
      setFieldErrors({});
      const sentFrom = typeof document === "undefined" ? null : document.activeElement;
      scopeRef.current =
        sentFrom && sentFrom !== document.body
          ? (sentFrom.closest('[role="dialog"], form, section') ?? document.body)
          : null;
      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await work();
        } catch {
          setError(options.failure);
          show(options.failure, "error");
          return;
        }

        if (!result.ok) {
          setFieldErrors(result.fieldErrors ?? {});
          options.onRefused?.(result.fieldErrors ?? {});
          if (Object.values(result.fieldErrors ?? {}).some((messages) => messages.length > 0)) {
            setFieldRefusals((count) => count + 1);
          }
          if (refusalIsOnShownFields(result.fieldErrors, options.shownOnFields)) return;
          setError(result.error || options.failure);
          show(result.error || options.failure, "error");
          return;
        }

        if (options.success) show(options.success, "success");
        options.onSuccess?.(result.data);
      });
    },
    [show],
  );

  return { run, pending, error, fieldErrors, reset, clearFieldError, clearError };
}

/** The first message for a field, or undefined — feeds the `error` prop on <Field>. */
export function fieldError(
  fieldErrors: Record<string, string[]>,
  key: string,
): string | undefined {
  return fieldErrors[key]?.[0];
}
