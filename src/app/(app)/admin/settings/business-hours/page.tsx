import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveBusinessHours } from "../actions";

const DAYS: [string, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];

export default async function BusinessHoursPage({ searchParams }: PageProps<"/admin/settings/business-hours">) {
  const { editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const hours = (byKey.get("business_hours") ?? {}) as Record<string, [string, string] | null>;
  const hoursSet = DAYS.some(([d]) => hours[d]);
  return (
    <>
      <PageHeader title="Business hours" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <p className="mb-4 text-sm text-muted">Toronto time. The lead timer on My day and the second alert after 45 business minutes count only these hours.{!hoursSet && <span className="text-warning"> Not set yet.</span>}</p>
        <form action={saveBusinessHours} className="grid gap-2">
          <fieldset disabled={!editable} className="grid gap-2">
            {DAYS.map(([d, label]) => {
              const h = hours[d];
              return (
                <div key={d} className="grid grid-cols-[7rem_5rem_11rem_2rem_11rem] items-center justify-start gap-2 text-sm">
                  <span>{label}</span>
                  <label className="flex items-center gap-1.5"><input type="checkbox" name={`${d}_open`} defaultChecked={!!h} className="h-4 w-4 accent-navy-700" />Open</label>
                  <input type="time" name={`${d}_start`} defaultValue={h?.[0] ?? "09:00"} aria-label={`${label} start`} className="input" />
                  <span className="text-center text-muted">to</span>
                  <input type="time" name={`${d}_end`} defaultValue={h?.[1] ?? "17:00"} aria-label={`${label} end`} className="input" />
                </div>
              );
            })}
            {editable && <button type="submit" className="btn mt-2 w-fit">Save business hours</button>}
          </fieldset>
        </form>
      </section>
    </>
  );
}
