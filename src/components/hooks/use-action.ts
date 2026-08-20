// One place for calling a server action from the UI: pending state, field errors, toasts.

"use client";

import { useCallback, useState, useTransition } from "react";
import { useToast } from "@/components/ui";
import type { ActionResult } from "@/lib/zod-schemas";

type RunOptions<T> = {
  /** Toast shown when the action succeeds. */
  success?: string;
  /** Message shown in the form's banner if the server sends no better one. */
  failure: string;
  onSuccess?: (data: T) => void;
};

export function useAction() {
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  const run = useCallback(
    <T,>(work: () => Promise<ActionResult<T>>, options: RunOptions<T>) => {
      setError(null);
      setFieldErrors({});
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
          setError(result.error || options.failure);
          setFieldErrors(result.fieldErrors ?? {});
          show(result.error || options.failure, "error");
          return;
        }

        if (options.success) show(options.success, "success");
        options.onSuccess?.(result.data);
      });
    },
    [show],
  );

  return { run, pending, error, fieldErrors, reset };
}

/** The first message for a field, or undefined — feeds the `error` prop on <Field>. */
export function fieldError(
  fieldErrors: Record<string, string[]>,
  key: string,
): string | undefined {
  return fieldErrors[key]?.[0];
}
