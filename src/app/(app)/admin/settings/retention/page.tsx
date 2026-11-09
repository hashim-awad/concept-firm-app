import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveRetention } from "../actions";

export default async function RetentionPage({ searchParams }: PageProps<"/admin/settings/retention">) {
  const { editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const retention = Number(byKey.get("retention_months") ?? 24);
  return (
    <>
      <PageHeader title="Retention" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveRetention} className="card">
        <fieldset disabled={!editable} className="space-y-3">
          <legend className="sr-only">Retention</legend>
          <p className="text-sm text-muted">
            Lost and out-of-scope leads, with their screening answers, are deleted automatically this many months after they close.
            Signed documents and signing records are always kept.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="months" className="label">Months</label>
              <input id="months" name="months" type="number" min={1} max={120} step={1} defaultValue={retention} required className="input w-28" />
            </div>
            {editable && <button type="submit" className="btn">Save retention</button>}
          </div>
        </fieldset>
      </form>
    </>
  );
}
