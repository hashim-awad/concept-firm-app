"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { todayToronto } from "@/lib/dates";
import { cleanReason, t2DeadlinesDueBefore } from "@/lib/deadlines";
import { loadT2 } from "./my-day-deadlines";

const KEY = /^([0-9a-f-]{36})\|(\d{4}-\d{2}-\d{2})\|([a-z0-9_]{2,40})$/;
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
// Back to My day, keeping "Show done" on when it was on.
const back = (formData: FormData) => (formData.get("view") === "done" ? "/?done=1" : "/");
function done(path: string, kind: "msg" | "error", text: string): never {
  revalidatePath("/");
  redirect(withMessage(path, kind, text));
}

// My day: mark T2 deadlines done (filed, or balance paid). One ("one" button) or the ticked ones
// ("items"). Recorded with who and when.
export async function markDeadlinesDone(formData: FormData): Promise<void> {
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) return;
  const one = formData.get("one");
  const keys = one ? [String(one)] : formData.getAll("items").map(String);
  const rows = keys.slice(0, 500).map((k) => k.split("|")).filter(([c, y, kind]) => /^[0-9a-f-]{36}$/.test(c ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(y ?? "") && (kind === "filing" || kind === "balance"))
    .map(([client_id, year_end, kind]) => ({ client_id, year_end, kind }));
  if (!rows.length) return;
  const supabase = await createClient();
  await supabase.from("t2_deadline_done").upsert(rows, { onConflict: "client_id,year_end,kind", ignoreDuplicates: true });
  revalidatePath("/");
}

// Owners: every open deadline due before a date, done in one step with one reason. The list is worked out
// again here from the date; the dialog's list is only what the owner saw. "expected" is the number shown:
// if the list changed in between, nothing is marked and the owner checks again.
export async function markDoneBefore(formData: FormData): Promise<void> {
  const path = back(formData);
  const access = await getAccess();
  if (!(!!access && access.admin)) done(path, "error", "Only an Admin can mark deadlines done in one step.");
  const before = String(formData.get("before") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) done(path, "error", "Choose the date.");
  const reason = cleanReason(String(formData.get("reason") ?? ""));
  if (!reason) done(path, "error", "Give the reason (2 to 200 characters).");
  const supabase = await createClient();
  const { clients, doneKeys } = await loadT2(supabase);
  const items = t2DeadlinesDueBefore(clients, todayToronto(), doneKeys, before);
  if (!items.length) done(path, "error", "No open deadlines are due before that date.");
  const expected = Number(formData.get("expected"));
  if (Number.isFinite(expected) && expected > 0 && expected !== items.length) {
    done(path, "error", `The list changed: ${count(items.length, "deadline")} now due before that date, not ${expected}. Nothing was marked. Open the dialog again and check the list.`);
  }
  const { data, error } = await supabase.rpc("deadlines_mark_done_before", {
    p_before: before, p_reason: reason,
    p_items: items.map((x) => ({ client_id: x.clientId, year_end: x.yearEnd, kind: x.kind })),
  });
  if (error) done(path, "error", error.message);
  const n = Number((data as { count?: number } | null)?.count ?? 0);
  done(path, "msg", `${count(n, "deadline")} marked done.`);
}

// Owners: undo a "Mark done before a date" batch, on the day it was made.
export async function undoDeadlineBatch(formData: FormData): Promise<void> {
  const path = back(formData);
  const batch = String(formData.get("batch") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(batch)) done(path, "error", "That batch was not found.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deadlines_undo_batch", { p_batch: batch });
  if (error) done(path, "error", error.message);
  done(path, "msg", `${count(Number(data ?? 0), "deadline")} reopened.`);
}

// Reopen one deadline marked done (Clients edit): deletes its done line, so it shows as open again.
export async function reopenDeadline(formData: FormData): Promise<void> {
  const path = back(formData);
  const access = await getAccess();
  if (!access || !canEdit(access, "clients")) done(path, "error", "Your role cannot reopen deadlines.");
  const m = KEY.exec(String(formData.get("reopen") ?? ""));
  if (!m) done(path, "error", "That deadline was not found.");
  const supabase = await createClient();
  const { error, count: n } = await supabase.from("t2_deadline_done").delete({ count: "exact" })
    .eq("client_id", m[1]).eq("year_end", m[2]).eq("kind", m[3]);
  if (error) done(path, "error", error.message);
  if (!n) done(path, "error", "Nothing was reopened. The deadline may already be open.");
  done(path, "msg", "Deadline reopened.");
}
