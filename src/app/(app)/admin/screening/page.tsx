import Link from "next/link";
import { PageHeader, Notice, formatDateTime } from "@/components/ui";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { createDraft, deleteDraft } from "./actions";

type Q = { id: string; route: string; version: number; status: string; title: string; published_at: string | null; updated_at: string };

const ROUTES = [
  { route: "personal", label: "Personal tax (start page: File your personal tax return)" },
  { route: "corporate", label: "Corporate tax (start page: File your corporate tax return)" },
];

export default async function ScreeningPage({ searchParams }: PageProps<"/admin/screening">) {
  const access = await requireAccess("price_book", "view");
  const editable = canEdit(access, "price_book");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("questionnaires").select("id, route, version, status, title, published_at, updated_at").order("version", { ascending: false });
  const all = (data ?? []) as Q[];

  return (
    <>
      <PageHeader title="Screening questions" description="The questions clients answer, and the rules that turn answers into a quote. Change a draft, test it, then publish." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      {ROUTES.map(({ route, label }) => {
        const published = all.find((q) => q.route === route && q.status === "published");
        const draft = all.find((q) => q.route === route && q.status === "draft");
        const retired = all.filter((q) => q.route === route && q.status === "retired");
        return (
          <section key={route} className="card mb-6">
            <h2 className="mb-3 font-semibold">{label}</h2>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="font-medium">Live: </span>
                  {published ? `Version ${published.version}, published ${formatDateTime(published.published_at)}` : <span className="text-danger">Nothing published yet. Clients cannot use this route.</span>}
                </span>
                {published && (
                  <span className="flex gap-2">
                    <Link href={`/admin/screening/${published.id}`} className="btn-secondary">View</Link>
                    <Link href={`/admin/screening/${published.id}/try`} className="btn-secondary">Try it</Link>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="font-medium">Draft: </span>
                  {draft ? `Version ${draft.version}, last changed ${formatDateTime(draft.updated_at)}` : "None"}
                </span>
                <span className="flex gap-2">
                  {draft && <Link href={`/admin/screening/${draft.id}`} className="btn">Open draft</Link>}
                  {draft && <Link href={`/admin/screening/${draft.id}/try`} className="btn-secondary">Try it</Link>}
                  {editable && !draft && published && (
                    <form action={createDraft}>
                      <input type="hidden" name="route" value={route} />
                      <button type="submit" className="btn-secondary">Start a new draft</button>
                    </form>
                  )}
                  {editable && draft && published && (
                    <form action={deleteDraft}>
                      <input type="hidden" name="id" value={draft.id} />
                      <button type="submit" className="btn-danger">Delete draft</button>
                    </form>
                  )}
                </span>
              </div>
              {retired.length > 0 && (
                <p className="text-muted">
                  Earlier versions:{" "}
                  {retired.map((r, i) => (
                    <span key={r.id}>{i > 0 && ", "}<Link href={`/admin/screening/${r.id}`} className="underline">v{r.version}</Link></span>
                  ))}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
