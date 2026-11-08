// The editable wording pieces (generated from the engine) and the check every edit must pass.
import pieces from "./wording.generated.json";

export type Piece = { key: string; text: string; fns: string[] };
export const PIECES = pieces as Piece[];
export const PIECE = new Map(PIECES.map((p) => [p.key, p]));

const tokens = (t: string) => (t.match(/\{\d+\}/g) ?? []).sort().join(" ");

// An edit keeps every fill-in ({1}, {2} ...) of the original, exactly once each.
export function checkEdit(key: string, text: string): string | null {
  const p = PIECE.get(key);
  if (!p) return "Unknown wording piece.";
  if (!text.trim()) return "The wording cannot be blank.";
  if (text.length > 5000) return "The wording is too long.";
  if (tokens(text) !== tokens(p.text)) {
    const need = tokens(p.text);
    return need ? `Keep each fill-in exactly once: ${need.replace(/ /g, ", ")}. The app puts names, dates and fees there.` : "This wording has no fill-ins. Remove {1}, {2} and so on.";
  }
  return null;
}
