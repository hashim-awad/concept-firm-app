import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import { PriceBookTabs } from "../tabs";
import { approveTemplate } from "./actions";

type T = { k: string; name: string; group: string; basis: string; status: string };
const GROUPS = ["Engagement letters", "Service schedules", "Shared parts", "Quality control", "Planned"];

export default async function TemplatesPage({ searchParams }: PageProps<"/admin/price-book/templates">) {
  const access = await requireAccess("price_book", "view");
  const sp = await searchParams;
  const e = createStudioEngine({});
  const supabase = await createClient();
  const { data } = await supabase.from("template_approvals").select("template_key, el_version, approved_on").eq("el_version", e.EL_VERSION);
  const approved = new Map((data ?? []).map((a) => [a.template_key, a]));
  const templates = e.TEMPLATES as T[];
  return (
    <>
      <PageHeader title="Price book" description="Template library: the master wording and its approval status." />
      <PriceBookTabs current="/admin/price-book/templates" />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <p className="mb-4 text-sm text-ink-2">Current wording version: <b>{e.EL_VERSION}</b> ({formatDate(e.EL_VERSION_DATE)}). Wording changes only through a new release, tested against Studio. Approving a trial template is recorded with your name and the date.</p>
      {GROUPS.map((g) => {
        const L = templates.filter((t) => t.group === g);
        if (!L.length) return null;
        return (
          <section key={g} className="card mb-6 overflow-x-auto p-0">
            <h2 className="px-5 pt-4 pb-2 font-semibold">{g}</h2>
            <table className="table">
              <thead><tr><th>Template</th><th>Status</th><th>Source</th><th>Approval</th><th></th></tr></thead>
              <tbody>{L.map((t) => {
                const ap = approved.get(t.k);
                const st = ap && t.status === "Trial" ? "Live" : t.status;
                return (
                  <tr key={t.k}>
                    <td>{t.name}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st === "Live" ? "bg-success-soft text-[#14532F]" : st === "Trial" ? "bg-warning-soft text-[#5C3D00]" : "bg-sand-100 text-ink-2"}`}>{st}</span></td>
                    <td className="text-sm text-ink-3">{t.basis}</td>
                    <td className="text-sm">{ap ? `Approved ${formatDate(ap.approved_on)} (${ap.el_version})` : t.status === "Live" ? "Approved at release" : t.status === "Trial" ? "Awaiting approval" : "Not built"}</td>
                    <td className="text-right">{t.status === "Trial" && !ap && access.is_owner && (
                      <form action={approveTemplate}><input type="hidden" name="key" value={t.k} /><button className="text-sm text-navy-700 underline" type="submit">Approve</button></form>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
