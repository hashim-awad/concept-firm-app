// Node module hooks for the answer-key runner: the app's "@/..." alias, "server-only" (a no-op outside Next.js),
// and relative imports written without the .ts extension.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tryFile = (p) => [p, `${p}.ts`, `${p}.tsx`, path.join(p, "index.ts")].find((x) => existsSync(x) && !x.endsWith(path.sep));
export async function resolve(spec, ctx, next) {
  if (spec === "server-only") return { url: pathToFileURL(path.join(root, "scripts/answer-keys/empty.mjs")).href, shortCircuit: true };
  if (/^next\/(headers|cache|navigation)(\.js)?$/.test(spec)) return { url: pathToFileURL(path.join(root, "scripts/answer-keys/next-stub.mjs")).href, shortCircuit: true };
  if (spec.startsWith("@/")) { const f = tryFile(path.join(root, "src", spec.slice(2))); if (f) return { url: pathToFileURL(f).href, shortCircuit: true }; }
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    if (!existsSync(base) || !/\.[cm]?[jt]sx?$/.test(base)) { const f = tryFile(base); if (f) return { url: pathToFileURL(f).href, shortCircuit: true }; }
  }
  return next(spec, ctx);
}
