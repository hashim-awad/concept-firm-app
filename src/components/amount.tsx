"use client";
// Amounts on screen (Hashim, Nov 15, 2026, item C): a negative shows in brackets, (62,679.00), in red, in
// boxes once typed and in totals. Exception: the trial balance and lead sheets, where brackets mean a credit
// balance; pass credit to keep them black there. PDFs, Excel and client documents use bracketAmount
// (black) and never these components.
import { useState, type InputHTMLAttributes } from "react";
import { bracketAmount, isNegativeText, tidyAmount } from "@/lib/closebook/amount";

// A figure in cents: (1,234.00) in red when negative; black when credit (trial balance, lead sheets).
export function Amount({ cents, credit = false, className = "" }: { cents: number; credit?: boolean; className?: string }) {
  return <span className={`tabular-nums ${cents < 0 && !credit ? "text-danger" : ""} ${className}`}>{bracketAmount(cents)}</span>;
}

// The class for a typed amount: red when it reads as negative.
// "!" wins over the .input class colour.
export const amountTone = (text: string) => (isNegativeText(text) ? "!text-danger" : "");

// A controlled amount box: accepts a minus sign or brackets, tidies to 1,234.00 or (1,234.00) on leaving,
// red when negative. value and onValue carry the typed text.
export function AmountInput({ value, onValue, className = "", ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: string; onValue: (text: string) => void }) {
  return (
    <input {...rest} type="text" inputMode="decimal" value={value}
      onChange={(e) => onValue(e.target.value)}
      onBlur={(e) => { onValue(tidyAmount(e.target.value)); rest.onBlur?.(e); }}
      className={`text-right tabular-nums ${amountTone(value)} ${className}`} />
  );
}

// The same box for a plain form (FormData, defaultValue): it keeps its own text. The server reads the
// value with parseAmount, so a minus sign or brackets both work end to end.
export function AmountField({ defaultValue = "", onValue, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue"> & { defaultValue?: string; onValue?: (text: string) => void }) {
  const [text, setText] = useState(() => tidyAmount(defaultValue));
  return <AmountInput {...rest} value={text} onValue={(t) => { setText(t); onValue?.(t); }} />;
}
