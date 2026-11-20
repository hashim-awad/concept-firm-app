// UI1 lessons (Hashim, Nov 20, 2026): Next.js names every server action with an id salted by the build's key. Two builds
// with different keys give every action a new id, and a parity compare then reports every function as missing. Builds
// made with scripts/dev/up.sh use one fixed local key (scripts/dev/.actions-key), so their ids compare. This warns
// before a capture when the running build was not made with that key. Local only.
import { existsSync, readFileSync } from "node:fs";

export function checkBuildKey() {
  const manifest = ".next/server/server-reference-manifest.json", key = "scripts/dev/.actions-key";
  if (!existsSync(manifest)) return;
  const built = JSON.parse(readFileSync(manifest, "utf8")).encryptionKey;
  const fixed = existsSync(key) ? readFileSync(key, "utf8").trim() : null;
  if (!fixed || built !== fixed) {
    console.warn("WARNING: this build was not made with the fixed local key (scripts/dev/.actions-key). Rebuild with");
    console.warn("  bash scripts/dev/up.sh --build");
    console.warn("for both the before and the after build, or the compare will report every action as missing.");
  }
}
