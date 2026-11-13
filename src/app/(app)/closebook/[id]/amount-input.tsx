"use client";
// An amount box that shows 48,210.00 once typed (layout item 11). Inside a server form it posts the text;
// the server reads it with commas.
import { tidyAmount } from "@/lib/closebook/amount";

export function AmountInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} inputMode="decimal" onBlur={(e) => { e.currentTarget.value = tidyAmount(e.currentTarget.value); props.onBlur?.(e); }} />;
}
