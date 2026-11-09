// Turns ?msg= and ?error= into text for the page. Keeps messages out of the URL as free text
// where possible; database messages are plain sentences written in the migrations.
const KNOWN: Record<string, string> = {
  "no-permission": "You do not have access to that page.",
  "owners-only": "Only an owner can open that page.",
  "pricing-needed": "That page shows prices. Your role does not include the Pricing permission.",
};

export function messageFrom(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  return KNOWN[v] ?? v.slice(0, 300);
}

export function withMessage(path: string, kind: "msg" | "error", text: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${kind}=${encodeURIComponent(text)}`;
}
