import Link from "next/link";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveStartPage } from "../actions";

export default async function StartPageSetting({ searchParams }: PageProps<"/admin/settings/start-page">) {
  const { access, editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const startOpen = byKey.get("start_page_open") === true;
  return (
    <>
      <PageHeader title="Public start page" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <p className="mb-4 text-sm text-muted">The page clients use to ask for a quote: <Link href="/start" className="text-navy-700 underline">/start</Link>. While closed, only signed-in staff can see it. Open it when the screening questions are ready. Only an owner can change this.</p>
        <form action={saveStartPage} className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="open" defaultChecked={startOpen} disabled={!access.is_owner} className="h-4 w-4 accent-navy-700" />Open to the public</label>
          {access.is_owner && <button type="submit" className="btn-secondary">Save</button>}
          <span className={startOpen ? "font-medium text-success" : "text-muted"}>Now: {startOpen ? "open" : "closed"}</span>
        </form>
      </section>
    </>
  );
}
