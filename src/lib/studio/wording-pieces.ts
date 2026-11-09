// The editable wording pieces (generated from the engine) and the check every edit must pass.
// On screen, fill-ins show by name, like [Company name]; they are stored as {1}, {2} ...
import pieces from "./wording.generated.json" with { type: "json" };

export type Piece = { key: string; text: string; fns: string[]; fills?: string[] };
export const PIECES = pieces as Piece[];
export const PIECE = new Map(PIECES.map((p) => [p.key, p]));

const tokens = (t: string) => (t.match(/\{\d+\}/g) ?? []).sort().join(" ");
const fillsOf = (key: string) => PIECE.get(key)?.fills ?? [];

// {1} -> [Company name]
export function toFriendly(key: string, text: string): string {
  const f = fillsOf(key);
  return text.replace(/\{(\d+)\}/g, (m, i) => (f[Number(i) - 1] ? `[${f[Number(i) - 1]}]` : m));
}

// [Company name] -> {1}. Brackets that are not one of this piece's fill-ins stay as typed.
export function fromFriendly(key: string, text: string): string {
  const f = fillsOf(key);
  return text.replace(/\[([^\]\n]{1,40})\]/g, (m, name) => { const i = f.indexOf(name.trim()); return i >= 0 ? `{${i + 1}}` : m; });
}

// An edit keeps every fill-in of the original, exactly once each.
export function checkEdit(key: string, text: string): string | null {
  const p = PIECE.get(key);
  if (!p) return "Unknown wording.";
  if (!text.trim()) return "The wording cannot be blank.";
  if (text.length > 5000) return "The wording is too long.";
  if (tokens(text) !== tokens(p.text)) {
    const names = (p.fills ?? []).map((n) => `[${n}]`);
    return names.length ? `Keep each of these once: ${names.join(", ")}. The app fills them in for each client.` : "This text has no fill-ins. Remove anything in [square brackets].";
  }
  return null;
}
