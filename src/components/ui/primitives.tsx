// Form and layout primitives: Button, Input, Select, Textarea, DateInput, Card, Badge, Spinner.

"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-mid)] disabled:bg-[var(--brand-gray)]",
  secondary:
    "bg-white text-[var(--brand-primary)] border border-[var(--brand-primary)] hover:bg-[var(--page-bg)] disabled:text-[var(--brand-gray)] disabled:border-[var(--brand-gray)]",
  danger:
    "bg-[var(--status-blocked)] text-white hover:opacity-90 disabled:bg-[var(--brand-gray)]",
  ghost:
    "bg-transparent text-[var(--brand-text)] hover:bg-[var(--page-bg)] disabled:text-[var(--brand-gray)]",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON_STYLES[variant]} ${className}`}
    >
      {loading ? <Spinner size={16} /> : null}
      {children}
    </button>
  );
}

const FIELD_CLASS =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--brand-text)] placeholder:text-[var(--brand-gray)] focus:border-[var(--brand-primary)] focus:outline-none disabled:bg-[var(--page-bg)]";

type FieldWrapProps = { label?: string; hint?: string; error?: string; children: ReactNode };

export function Field({ label, hint, error, children }: FieldWrapProps) {
  return (
    <label className="block space-y-1">
      {label ? <span className="block text-sm font-semibold text-[var(--brand-ink)]">{label}</span> : null}
      {children}
      {error ? (
        <span className="block text-xs text-[var(--status-blocked)]">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-[var(--brand-gray)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${FIELD_CLASS} ${className}`} />;
}

export function DateInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" {...rest} className={`${FIELD_CLASS} ${className}`} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${FIELD_CLASS} min-h-24 ${className}`} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${FIELD_CLASS} ${className}`}>
      {children}
    </select>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-white ${className}`}
    >
      {title || action ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          {title ? (
            <h2 className="text-sm font-semibold text-[var(--brand-ink)]">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

export function Badge({
  children,
  color = "var(--brand-gray)",
  textColor = "#ffffff",
}: {
  children: ReactNode;
  color?: string;
  textColor?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: color, color: textColor }}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
