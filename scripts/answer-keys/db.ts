// Database access for the answer-key runner: psql on the LOCAL database only. It refuses any other host, so an
// answer key can never read or write a Live file.
import { execFileSync } from "node:child_process";

const URL_ = process.env.ANSWER_KEYS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = new URL(URL_).hostname;
if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Answer keys run on the local database only, not ${host}.`);

export function sql(text: string): string {
  return execFileSync("psql", [URL_, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8", maxBuffer: 1 << 30 });
}
export const json = <T>(text: string): T => JSON.parse(sql(text).trim() || "null") as T;
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
