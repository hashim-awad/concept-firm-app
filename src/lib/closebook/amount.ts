// Amounts typed by staff (Hashim, Nov 15, 2026, layout item 11): thousands separators and two decimals
// everywhere, including inside an input once typed (48,210.00). Accepts what people type: commas,
// spaces, a dollar sign, 0 to 2 decimals. Pure and tested. Cents.
// Negative amounts (Hashim, Nov 15, 2026, item C): a minus sign or brackets both mean negative:
// "(62,679.00)", "-62,679.00", "62,679.00-" and "−62,679.00" (the typographic minus) are all -6267900.
// On screen a negative shows in brackets, (62,679.00), in red; on PDFs, Excel and client documents in
// black (see bracketAmount, and the Amount components in src/components/amount.tsx).
export function parseAmount(text: string): number | null {
  let t = text.replace(/[\s,$ ]/g, "").replace(/[−‒–]/g, "-");
  let neg = false;
  const br = /^\((.*)\)$/.exec(t);
  if (br) { neg = true; t = br[1]; }
  if (/^-.+/.test(t)) { if (br) return null; neg = true; t = t.slice(1); }
  else if (/.+-$/.test(t)) { if (br) return null; neg = true; t = t.slice(0, -1); }
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return neg && c !== 0 ? -c : c;
}
const plain = (cents: number) => (Math.abs(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// With a leading minus: for CSV files and other machine-read output.
export const formatAmount = (cents: number) => `${cents < 0 ? "-" : ""}${plain(cents)}`;
// With brackets for a negative: what people read (screens, PDFs, Excel, client documents).
export const bracketAmount = (cents: number) => (cents < 0 ? `(${plain(cents)})` : plain(cents));
// On leaving a box: the typed amount, formatted (a negative in brackets); anything unreadable stays as
// typed (so the check shows).
export const tidyAmount = (text: string) => { const c = parseAmount(text); return text.trim() === "" || c === null ? text : bracketAmount(c); };
// The box's text is a negative amount (for the red colour).
export const isNegativeText = (text: string) => { const c = parseAmount(text); return c !== null && c < 0; };
// The on-screen class for a figure (cents or dollars): red when negative (item C). Pure, so server
// components can use it too. Not for the trial balance and lead sheets, where brackets mean a credit.
export const negativeTone = (n: number | null | undefined) => (n != null && n < 0 ? "text-danger" : "");
