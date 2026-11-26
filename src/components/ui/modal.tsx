// Modal — a focus-trapping dialog: Tab stays inside it and the page behind is switched off, no library needed.

"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

const SIZE_CLASS = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl" } as const;

/** What had focus just before a dialog opened — normally the button that opened it. */
export function rememberOpener(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * Puts focus back on the opener once a dialog has closed, so a keyboard user carries on from the
 * button they pressed instead of starting again at the top of the page. Skipped when the opener has
 * left the page (a menu that closed, a row that was deleted) and when focus has already been moved
 * somewhere on purpose — only focus that was inside the dialog, or dropped on the page, is returned.
 */
export function returnFocusTo(opener: HTMLElement | null, dialog: HTMLElement | null): void {
  if (!opener || !opener.isConnected) return;
  const active = document.activeElement;
  const lost = !active || active === document.body || (dialog !== null && dialog.contains(active));
  if (lost) opener.focus();
}

/**
 * Picks where focus goes once a dialog has closed — see `focusAfterCloseRef` on `Modal`. It is
 * handed what opened the dialog, and may be asked more than once (see `focusWhenReady`).
 */
export type FocusAfterClose = (opener: HTMLElement | null) => HTMLElement | null | undefined;

/**
 * Moves focus to what `pick` names, for after a dialog has closed. It is called once the page
 * behind is switched back on — while a dialog is open the page is inert and refuses focus, which
 * is why a focus move made from inside the dialog's own button used to land at the top of the page.
 * A target that cannot take focus yet (a button greyed out until the request that closed the dialog
 * settles) is tried again for up to two seconds — the same one, once found, while it is still on the
 * page; `fallback` runs if it never can. Once somebody has moved focus themselves (a click, a Tab),
 * it stops and leaves their choice alone.
 */
export function focusWhenReady(
  pick: () => HTMLElement | null | undefined,
  fallback: () => void = () => undefined,
): void {
  const TRIES = 40;
  // A target, once found, is kept while it is on the page: the neighbour is worked out from the row
  // that is going, and by the second try the list may already have refreshed without that row.
  let chosen: HTMLElement | null = null;
  const attempt = (left: number) => {
    const active = document.activeElement;
    if (left < TRIES && active && active !== document.body) return;
    if (!chosen?.isConnected) chosen = pick() ?? null;
    const target = chosen;
    if (target?.isConnected) {
      target.focus();
      if (document.activeElement === target) return;
    }
    if (left <= 0) {
      fallback();
      return;
    }
    setTimeout(() => attempt(left - 1), 50);
  };
  attempt(TRIES);
}

/**
 * The nearest element matching `selector` after `from` in page order (inside `scope`), else the
 * nearest before it — skipping anything inside `from` itself. The neighbour a keyboard user lands
 * on once the row they acted on is gone: the next comment's "⋯", the member above, and so on.
 */
export function neighbourOf(
  from: Element | null | undefined,
  selector: string,
  scope: ParentNode = document,
): HTMLElement | null {
  // A row already taken off the page has no place in it to measure from.
  if (!from || !from.isConnected) return null;
  // Only what is drawn: a list kept twice (phone cards and a laptop table) hides one copy.
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      !from.contains(element) &&
      (typeof element.checkVisibility !== "function" || element.checkVisibility()),
  );
  const after = candidates.find(
    (element) => from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  if (after) return after;
  const before = candidates.filter(
    (element) => from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  return before[before.length - 1] ?? null;
}

/**
 * For a check whose own row or card is redrawn once the change lands (a deactivated person's
 * "Deactivate" becoming "Reactivate", a removed connection's buttons becoming the connect form): waits
 * until the opener has left the page, then picks the first thing Tab reaches in the block around it
 * (`scopeSelector`, looked up while the opener is still there).
 */
export function firstStopOnceRedrawn(scopeSelector: string): FocusAfterClose {
  let scope: Element | null = null;
  return (opener) => {
    if (!opener) return null;
    scope ??= opener.closest(scopeSelector);
    if (!scope?.isConnected || opener.isConnected) return null;
    return tabbableIn(scope as HTMLElement)[0] ?? null;
  };
}

/** Everything a person can reach with Tab, in page order. */
const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The boxes and buttons inside `container` that Tab really stops at (shown, not switched off). */
export function tabbableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter((element) => {
    if (element.tabIndex < 0 || element.closest("[inert], [hidden]")) return false;
    // A browser can tell whether the element is drawn at all; a test page without layout cannot,
    // and counts everything that is on the page.
    return typeof element.checkVisibility === "function" ? element.checkVisibility() : true;
  });
}

/** One open dialog's hold on the page: the background it has switched off, and its own node. */
type Trap = {
  dialog: HTMLElement;
  /** What stays switched on: the dialog's own wrapper (the dimmed backdrop), not just the box. */
  keepOn: Element;
  switchedOff: { element: Element; ariaHidden: boolean }[];
};

// Open dialogs, innermost last. Only the innermost one holds the page; a dialog opened from inside
// another hands the page back to the outer one when it closes.
const traps: Trap[] = [];

// The toasts (a live region) and Next's own route announcer stay audible behind a dialog.
const KEEP_LIVE = "[aria-live], [role='status'], [role='alert'], next-route-announcer, script, style";

/**
 * Switches off everything on the page except the dialog: each sibling of the dialog, and of every
 * element it sits in, becomes `inert` (no clicks, no Tab, no focus) and `aria-hidden` (a screen
 * reader's browse mode cannot wander behind it either). Only what this dialog changed is undone.
 */
function switchOffBackground(trap: Trap) {
  let element: Element = trap.keepOn;
  while (element.parentElement && element !== document.body) {
    const parent: Element = element.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === element || sibling.hasAttribute("inert") || sibling.matches(KEEP_LIVE)) continue;
      const ariaHidden = !sibling.hasAttribute("aria-hidden");
      sibling.setAttribute("inert", "");
      if (ariaHidden) sibling.setAttribute("aria-hidden", "true");
      trap.switchedOff.push({ element: sibling, ariaHidden });
    }
    element = parent;
  }
}

function switchBackgroundOn(trap: Trap) {
  for (const { element, ariaHidden } of trap.switchedOff) {
    element.removeAttribute("inert");
    if (ariaHidden) element.removeAttribute("aria-hidden");
  }
  trap.switchedOff = [];
}

/**
 * Keeps keyboard focus inside an open dialog until it closes, and returns the function that lets
 * go. Tab from the last button goes round to the first, Shift+Tab from the first (or from the
 * dialog itself) to the last, and a Tab pressed while focus has dropped onto the page (a step that
 * swapped its buttons out) lands back inside the dialog. Only Tab is ever touched — a letter typed
 * into a box never moves focus — and it is called once, from the effect that runs when the dialog
 * opens, so nothing here re-runs while someone types.
 */
export function trapFocus(dialog: HTMLElement): () => void {
  const previous = traps[traps.length - 1];
  if (previous) switchBackgroundOn(previous);
  const trap: Trap = { dialog, keepOn: dialog.parentElement ?? dialog, switchedOff: [] };
  traps.push(trap);
  switchOffBackground(trap);
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || traps[traps.length - 1] !== trap) return;
    const stops = tabbableIn(dialog);
    const active = document.activeElement;
    if (stops.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const inside = active instanceof Node && dialog.contains(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("keydown", onKey);
    switchBackgroundOn(trap);
    const index = traps.indexOf(trap);
    if (index === -1) return;
    traps.splice(index, 1);
    // The innermost dialog closed: the one it was opened from holds the page again.
    const outer = traps[traps.length - 1];
    if (outer && index === traps.length) switchOffBackground(outer);
  };
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
  returnFocusRef,
  initialFocusRef,
  focusAfterCloseRef,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZE_CLASS;
  /**
   * Where focus goes when the dialog closes, for a dialog opened from a menu. The menu item that was
   * pressed has already gone by the time the dialog opens, so there is no opener to remember; the
   * menu's own "Options for…" button is the place a keyboard user expects to land instead.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * What takes focus when the dialog opens, instead of the dialog itself — a "Delete …?" check
   * starts on its Cancel button, so an Enter pressed without reading does no harm.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Somewhere other than the opener for focus to go once the dialog has closed, set by the dialog
   * just before it closes — a "Delete …?" check whose row (and so its opener) is about to go names
   * a neighbour here. It runs after the dialog has gone and the page behind is switched back on; a
   * focus move made while the dialog is still open is refused by the inert page and lands on
   * nothing. Used once, then cleared.
   */
  focusAfterCloseRef?: RefObject<FocusAfterClose | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest close handler, kept to one side. Most dialogs hand in a fresh function on every
  // render (an inline arrow, or one that reads the form's state), and that used to re-run the effect
  // below on every keystroke — which pulled focus back onto the dialog after the first letter typed.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Runs when the dialog opens and only then: focus moves onto it once, and Escape closes it. On
  // closing, focus goes back to whatever opened it (see returnFocusTo below).
  useEffect(() => {
    if (!open) return;
    // A dialog opened from a menu names its own way back; any other remembers what had focus.
    const opener = returnFocusRef?.current ?? rememberOpener();
    const node = ref.current;
    const onKey = (event: KeyboardEvent) => {
      // A box inside the dialog that uses Escape itself (the people search closing its list) marks
      // the key as handled; only an Escape nobody else wanted closes the whole dialog.
      if (event.key === "Escape" && !event.defaultPrevented) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    // Tab stays inside the dialog and the page behind is switched off until it closes.
    const release = node ? trapFocus(node) : () => undefined;
    (initialFocusRef?.current ?? node)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      // The page comes back on first, so the opener behind the dialog can take focus again.
      release();
      const pick = focusAfterCloseRef?.current;
      if (pick && focusAfterCloseRef) {
        focusAfterCloseRef.current = null;
        focusWhenReady(() => pick(opener), () => returnFocusTo(opener, node));
        return;
      }
      returnFocusTo(opener, node);
    };
    // returnFocusRef, initialFocusRef and focusAfterCloseRef are ref objects — the same ones for
    // the dialog's whole life — so listing them never re-runs this effect while someone types.
  }, [open, returnFocusRef, initialFocusRef, focusAfterCloseRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--brand-ink)]/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${SIZE_CLASS[size]} overflow-y-auto rounded-[var(--radius)] bg-white shadow-lg focus:outline-none`}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--brand-ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            // A 44px tap area around the small mark; the negative margins keep the header its size.
            className="-my-2.5 -mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--brand-text)] hover:bg-[var(--page-bg)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </header>
        <div className="px-4 py-4 text-sm text-[var(--brand-text)]">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
