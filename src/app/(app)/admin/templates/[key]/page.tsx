import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import { loadStudioData } from "@/lib/studio/data";
import { templateSample } from "@/lib/studio/samples";
import { Paper } from "@/components/studio/kit";
import { approveTemplate } from "../actions";

type T = { k: string; name: string; group: string; basis: string; status: string };

export default async function TemplatePage({ params, searchParams }: PageProps<"/admin/templates/[key]">) {
  const access = await requireAccess("engagement_terms", "view");
  const { key } = await params;
  const sp = await searchParams;
  const e = createStudioEngine({});
  const t = (e.TEMPLATES as T[]).find((x) => x.k === key);
  if (!t || t.status === "Planned") notFound();
  const supabase = await createClient();
  const [{ data: ap }, data] = await Promise.all([
    supabase.from("template_approvals").select("approved_on, el_version").eq("template_key", key).order("approved_on", { ascending: false }).limit(1).maybeSingle(),
    loadStudioData(supabase, access),
  ]);
  const sample = templateSample(key, data.signers, data.wording);
  const status = ap && t.status === "Trial" ? "Live" : t.status;
  return (
    <>
      <PageHeader eyebrow="Template library" title={t.name}
        description={`${status}${ap ? `, approved ${formatDate(ap.approved_on)}` : t.status === "Live" ? ", approved at release" : ", awaiting approval"} · Wording ${data.wording?.label ?? e.EL_VERSION} · Source: ${t.basis}`}
        actions={<Link href="/admin/templates" className="btn-secondary btn">All templates</Link>} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <p className="mb-4 text-sm text-ink-2">
        This is the exact wording, built by the same code that makes the letters, filled in with made-up client details (Example Holdings Inc.). Names, dates and fees change with each client; the wording does not.
      </p>
      {sample?.note && <p className="card mb-4 text-sm">{sample.note}</p>}
      <div className="grid gap-6">
        {sample?.parts.map((p) => (
          <section key={p.label}>
            <h2 className="mb-2 text-base font-semibold text-navy-800">{p.label}</h2>
            <Paper id={`tpl-${key}-${p.label.length}`} html={p.html || "<p>Not shown in this sample.</p>"} draft={false} />
          </section>
        ))}
      </div>
      {t.status === "Trial" && !ap && (
        access.is_owner ? (
          <form action={approveTemplate} className="card mt-6 space-y-3">
            <input type="hidden" name="key" value={key} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="read" required className="h-4 w-4 accent-navy-700" /> I read this wording and approve it for client use.</label>
            <button className="btn" type="submit">Approve</button>
          </form>
        ) : <p className="card mt-6 text-sm text-muted">Awaiting an owner&rsquo;s approval.</p>
      )}
    </>
  );
}
