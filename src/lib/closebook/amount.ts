// Amounts typed by staff (Hashim, Nov 15, 2026, layout item 11): thousands separators and two decimals
// everywhere, including inside an input once typed (48,210.00). Accepts what people type: commas,
// spaces, a leading minus, 0 to 2 decimals. Pure and tested. Cents.
export function parseAmount(text: string): number | null {
  const t = text.replace(/[\s,$]/g, "");
  if (!/^-?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const formatAmount = (cents: number) =>
  `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// On leaving a box: the typed amount, formatted; anything unreadable stays as typed (so the check shows).
export const tidyAmount = (text: string) => { const c = parseAmount(text); return text.trim() === "" || c === null ? text : formatAmount(c); };
