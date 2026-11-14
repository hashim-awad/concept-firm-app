"use server";
// Step 8's GST/HST return and step 10's filing record (round 13). The database checks every rule again.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { withMessage } from "@/lib/messages";
import { parseAmount } from "@/lib/closebook/amount";
import { gstFor, QUICK_GAIN, storedLines } from "@/lib/closebook/gst-server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const done = (back: string, id: string, error: { message: string } | null, ok: string): never => {
  revalidatePath(`/closebook/${id}`);
  redirect(withMessage(back, error ? "error" : "msg", error ? error.message : ok));
};

// Prepare the year's returns: the instalments confirmed from the CRA account, the lines kept as worked
// out, and the check against 21500 with its one-line explanation.
export async function prepareGstReturns(formData: FormData) {
  const id = s(formData, "file_id"), back = `/closebook/${id}?step=t2#gst`;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
  const inst = new Map<number, number>();
  for (const k of formData.keys()) {
    const m = /^inst_(\d+)$/.exec(k);
    if (!m) continue;
    const c = parseAmount(s(formData, k) || "0");
    if (c === null || c < 0) redirect(withMessage(back, "error", `Instalments paid, period ${m[1]}: type the amount from the CRA account, for example 1,250.00. Nothing was saved.`));
    inst.set(Number(m[1]), c!);
  }
  const supabase = await createClient();
  const g = await gstFor(supabase, id, inst);
  if (!g || !g.applies) redirect(withMessage(back, "error", g && !g.applies ? g.reason : "This file was not found."));
  const G = g as Extract<NonNullable<typeof g>, { applies: true }>;
  for (const r of G.returns) {
    const { error } = await supabase.rpc("cb_prepare_gst_return", { p_file: id, p_period: r.period.n, p_label: r.period.label, p_start: r.period.start, p_end: r.period.end,
      p_due: r.period.due, p_instalments: r.lines["110"] / 100, p_lines: storedLines(r) });
    if (error) done(back, id, error, "");
  }
  const { error } = await supabase.rpc("cb_save_gst_check", { p_file: id, p_owing: G.check.owingCents / 100, p_book: G.check.bookCents / 100, p_note: s(formData, "note") });
  done(back, id, error, G.check.diffCents === 0 ? `GST/HST return${G.returns.length > 1 ? "s" : ""} prepared. The check against 21500 ties.` : `GST/HST return${G.returns.length > 1 ? "s" : ""} prepared.`);
}

export async function acceptGstCheck(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_accept_gst_check", { p_file: id, p_why: s(formData, "why") });
  done(`/closebook/${id}?step=t2#gst`, id, error, "The GST/HST difference is accepted.");
}

export async function saveGstFiling(formData: FormData) {
  const id = s(formData, "file_id");
  const { error } = await (await createClient()).rpc("cb_save_gst_filing", { p_file: id, p_period: Number(s(formData, "period")), p_filed: s(formData, "filed") || null, p_confirmation: s(formData, "confirmation") });
  done(`/closebook/${id}?step=lock`, id, error, "GST/HST filing record saved.");
}

// An entry that moves an amount into 21500 without a tax code: counted as an instalment, or left out.
export async function confirmGstEntry(formData: FormData) {
  const id = s(formData, "file_id");
  const yes = s(formData, "yes") === "yes";
  const { error } = await (await createClient()).rpc("cb_confirm_gst_entry", { p_file: id, p_entry: s(formData, "entry"), p_yes: yes });
  done(`/closebook/${id}?step=t2#gst`, id, error, yes ? "Counted as an instalment. Prepare the returns again." : "Left out of the instalments. Prepare the returns again.");
}

// The quick method gain: the GST/HST the company keeps under the quick method is income. The ready entry
// moves the difference out of 21500 into 42400 GST/HST quick method gain (GIFI 8230).
export async function bookQuickGain(formData: FormData) {
  const id = s(formData, "file_id"), back = `/closebook/${id}?step=t2#gst`;
  const a = await getAccess();
  if (!a || !canEdit(a, "closebook")) redirect(withMessage(back, "error", "You need Edit on Closebook."));
  const supabase = await createClient();
  const g = await gstFor(supabase, id);
  if (!g || !g.applies || !g.quick) redirect(withMessage(back, "error", "The quick method gain is for quick method files."));
  const G = g as Extract<NonNullable<typeof g>, { applies: true }>;
  const diff = G.check.diffCents;
  if (diff <= 0) redirect(withMessage(back, "error", "There is no quick method gain to book: 21500 does not hold more than the returns owe."));
  if (Math.round(Number(s(formData, "amount")) * 100) !== diff) redirect(withMessage(back, "error", "The difference changed. Look at the check again, then book it."));
  const { error } = await supabase.rpc("cb_add_entry", { p_file: id, p_kind: "AJE", p_reason: "correction", p_note: "GST/HST quick method gain: the tax kept under the quick method", p_reverse: false,
    p_lines: [{ chart: "21500", amount: diff / 100, memo: "Quick method gain" }, { chart: QUICK_GAIN, amount: -diff / 100, memo: "Quick method gain" }], p_wp_ref: "GST/HST return" });
  done(back, id, error, `Quick method gain of ${(diff / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} booked. Prepare the return again: the check now ties.`);
}
