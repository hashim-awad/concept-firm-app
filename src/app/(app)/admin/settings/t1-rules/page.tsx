import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDate } from "@/lib/dates";
import { loadSettings, readOnlyNote } from "../data";
import { saveT1Rules } from "../actions";

export default async function T1RulesPage({ searchParams }: PageProps<"/admin/settings/t1-rules">) {
  const { access, editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const t1 = (byKey.get("t1_rules") ?? {}) as { moving_km?: number; t1135_simple_over?: number; t1135_detailed_from?: number; checked_on?: string };
  return (
    <>
      <PageHeader title="T1 rule values" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <p className="mb-4 text-sm text-muted">Used by the personal tax screening questions. Check them on canada.ca when CRA changes a rule. Only an owner can change them.{t1.checked_on ? ` Last checked ${formatDate(t1.checked_on)}.` : ""}</p>
        <form action={saveT1Rules} className="grid gap-3 sm:grid-cols-2">
          <fieldset disabled={!access.is_owner} className="contents">
            <div><label htmlFor="moving_km" className="label">Moving expenses: minimum distance closer (km)</label><input id="moving_km" name="moving_km" inputMode="numeric" defaultValue={t1.moving_km ?? ""} className="input" /></div>
            <div><label htmlFor="checked_on" className="label">Checked on canada.ca on</label><input id="checked_on" name="checked_on" type="date" defaultValue={t1.checked_on ?? ""} className="input" /></div>
            <div><label htmlFor="t1135_simple_over" className="label">T1135 needed when foreign property cost more than ($)</label><input id="t1135_simple_over" name="t1135_simple_over" inputMode="numeric" defaultValue={t1.t1135_simple_over ?? ""} className="input" /></div>
            <div><label htmlFor="t1135_detailed_from" className="label">T1135 detailed method when cost was at least ($)</label><input id="t1135_detailed_from" name="t1135_detailed_from" inputMode="numeric" defaultValue={t1.t1135_detailed_from ?? ""} className="input" /></div>
            {access.is_owner && <div className="sm:col-span-2"><button type="submit" className="btn w-fit">Save T1 rule values</button></div>}
          </fieldset>
        </form>
      </section>
    </>
  );
}
