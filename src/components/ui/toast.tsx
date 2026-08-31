// Toast — one small context-based notice stack. Wrap a tree in <ToastProvider> and call useToast().

"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: string; message: string; tone: ToastTone };

type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);

const TONE_COLOR: Record<ToastTone, string> = {
  success: "var(--status-completed)",
  error: "var(--status-blocked)",
  info: "var(--brand-ink)",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems((current) => [...current, { id, message, tone }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-[var(--radius)] px-4 py-2 text-sm text-white shadow-lg"
            style={{ backgroundColor: TONE_COLOR[item.tone] }}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a short message. Falls back to doing nothing if no provider is mounted. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return context ?? { show: () => undefined };
}
