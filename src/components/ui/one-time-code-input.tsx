// The 6-digit code box used wherever an authenticator app's code is typed: sign-in, the Teams
// sign-in, and the two-factor card. Digits only — a letter is refused as it is typed, with a plain
// note saying why, so nobody submits "12a456" and is told only that the code was wrong.

"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/primitives";

export const ONE_TIME_CODE_LENGTH = 6;

/**
 * Keeps the digits of what was typed or pasted, up to six. Spaces and dashes are dropped quietly
 * (authenticator apps and emails often show "123 456" or "123-456"); anything else is reported, so
 * the box can say the code is numbers only.
 */
export function cleanOneTimeCode(raw: string): { code: string; refused: boolean } {
  const withoutSeparators = raw.replace(/[\s-]/g, "");
  const digits = withoutSeparators.replace(/\D/g, "");
  return {
    code: digits.slice(0, ONE_TIME_CODE_LENGTH),
    refused: digits.length !== withoutSeparators.length,
  };
}

export function OneTimeCodeInput({
  value,
  onChange,
  name,
  required,
  label = "Verification code",
}: {
  value: string;
  onChange: (code: string) => void;
  name?: string;
  required?: boolean;
  label?: string;
}) {
  const [refused, setRefused] = useState(false);

  return (
    <Field
      label={label}
      error={refused ? "The code is numbers only — the 6 digits shown in your authenticator app." : undefined}
    >
      <Input
        name={name}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        required={required}
        value={value}
        onChange={(event) => {
          const cleaned = cleanOneTimeCode(event.target.value);
          // The note stays up after the next digit, so it can actually be read, and goes once the
          // code is whole (or the box is emptied).
          setRefused((shown) =>
            cleaned.refused ||
            (shown && cleaned.code.length > 0 && cleaned.code.length < ONE_TIME_CODE_LENGTH),
          );
          onChange(cleaned.code);
        }}
        placeholder="123456"
        className="text-center font-mono text-lg tracking-widest"
      />
    </Field>
  );
}
