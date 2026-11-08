import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { lineName, planCleanup } from "@/lib/price-book/cleanup";
import { loadItems } from "@/lib/price-book/load";
import { applyCleanup } from "./actions";

const LINES = ["bookkeeping", "t2", "gst_hst", "payroll", "cfo", "advisory", "incorporation", "adjustments", "t1"];

export default async function CleanupPage({ searchParams }: PageProps<"/admin/price-book/cleanup">) {
  const access = await requireAccess("price_book", "view");
  const sp = await searchParams;
  const supabase = await createClient();
  const { items, lineKeys } = await loadItems(supabase);
  const { changes, plan, blockers, notes } = planCleanup(items, lineKeys);
  const real = items.filter((i) => !i.code.startsWith("T1_"));
  const blank = (f: "income_account" | "replaces_qbo" | "replaces_taxdome") => real.filter((i) => !i[f]?.trim()).map((i) => i.code);
  const ptx129 = items.find((i) => i.code === "PTX-129");
  const perClient = items.filter((i) => i.price_type === "Per client" && i.price_cents == null).length;

  return (
    <>
      <PageHeader eyebrow="Price book" title="Price book clean-up"
        description="Your corrections after the Studio import. Check the before and after, then apply. Nothing changes until you press Apply."
        actions={<Link href="/admin/price-book" className="btn-secondary btn">Back to price book</Link>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card mb-6 space-y-2 text-sm">
        <h2 className="text-base font-semibold">Checks</h2>
        <p><b>1. PTX-129 (T1135, detailed):</b>{" "}
          {ptx129
            ? <>in the price book{ptx129.price_cents != null ? `, $${(ptx129.price_cents / 100).toFixed(0)}` : ""}. Its decimal Order (51.5) is stored as is.</>
            : <span className="text-danger">not in the price book. Re-import the Service Catalog file (Settings, Import from Studio); it adds only this row.</span>}
        </p>
        <p><b>2. Corporate prices:</b> {perClient} item{perClient === 1 ? "" : "s"} with price type Per client and no price now show &ldquo;Priced per client (see packages)&rdquo;.</p>
        <p><b>6. Fields from Notion:</b> QBO income account blank on {blank("income_account").length}{blank("income_account").length ? ` (${blank("income_account").join(", ")})` : ""};
          &ldquo;Replaces in QBO&rdquo; filled on {real.length - blank("replaces_qbo").length} of {real.length};
          &ldquo;Replaces in TaxDome&rdquo; filled on {real.length - blank("replaces_taxdome").length} of {real.length}. Each is in its own field (see Edit on any item). Blank means blank in Notion.</p>
      </section>

      {blockers.length > 0 && (
        <section className="card mb-6 text-sm">
          <h2 className="mb-1 text-base font-semibold text-danger">Before you can apply</h2>
          <ul className="list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </section>
      )}

      <section className="card mb-6 overflow-x-auto p-0">
        <h2 className="px-5 pt-4 pb-2 font-semibold">Changes ({changes.length})</h2>
        {changes.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">Nothing to change. The price book matches your list.</p> : (
          <table className="table text-sm">
            <thead><tr><th>Item</th><th>Change</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{changes.map((c, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap"><span className="font-mono text-xs">{c.code}</span><span className="block">{c.name}</span></td>
                <td>{c.what}</td><td className="text-ink-2">{c.before}</td><td className="font-medium">{c.after}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      {notes.length > 0 && (
        <section className="card mb-6 text-sm">
          <h2 className="mb-1 text-base font-semibold">For your attention</h2>
          <ul className="list-disc pl-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      <section className="card mb-6 overflow-x-auto p-0">
        <h2 className="px-5 pt-4 pb-2 font-semibold">Service lines after the clean-up</h2>
        <table className="table text-sm">
          <thead><tr><th>Line</th><th>Items</th></tr></thead>
          <tbody>{LINES.map((k) => {
            const moved = real.filter((it) => { const op = plan.find((p) => p.op === "set_line" && p.code === it.code); return (op ? op.line : it.line) === k; }).map((it) => it.code);
            const added = plan.filter((p) => p.op === "add_item" && p.line === k).map((p) => String(p.code));
            return <tr key={k}><td className="whitespace-nowrap">{lineName(k)}</td><td className="font-mono text-xs">{[...moved, ...added].sort().join(", ") || "none"}</td></tr>;
          })}</tbody>
        </table>
      </section>

      {access.is_owner && plan.length > 0 && blockers.length === 0 && (
        <form action={applyCleanup} className="card space-y-3">
          <input type="hidden" name="plan" value={JSON.stringify(plan)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="read" required className="h-4 w-4 accent-navy-700" /> I checked the {changes.length} changes above.</label>
          <button className="btn" type="submit">Apply all changes</button>
        </form>
      )}
    </>
  );
}
