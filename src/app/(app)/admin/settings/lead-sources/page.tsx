import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveLeadSources } from "../actions";

export default async function LeadSourcesPage({ searchParams }: PageProps<"/admin/settings/lead-sources">) {
  const { editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const sources = (byKey.get("lead_sources") ?? []) as string[];
  return (
    <>
      <PageHeader title="Lead sources" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <p className="mb-4 text-sm text-muted">The choices for &ldquo;How did you hear about us?&rdquo; and the Source on each lead. One per line.</p>
        <form action={saveLeadSources} className="grid max-w-md gap-2">
          <textarea name="sources" rows={8} defaultValue={sources.join("\n")} disabled={!editable} aria-label="Lead sources, one per line" className="input" />
          {editable && <button type="submit" className="btn-secondary w-fit">Save lead sources</button>}
        </form>
      </section>
    </>
  );
}
