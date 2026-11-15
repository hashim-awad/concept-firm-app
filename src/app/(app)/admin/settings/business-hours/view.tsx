import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveBusinessHours } from "../actions";

const DAYS: [string, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];

export async function BusinessHoursView(sp: SP): Promise<View> {
  const { editable, byKey } = await loadSettings();
  const hours = (byKey.get("business_hours") ?? {}) as Record<string, [string, string] | null>;
  const hoursSet = DAYS.some(([d]) => hours[d]);
  return {
    help: <><p>Toronto time. The lead timer on My day and the second alert after 45 business minutes count only these hours.</p><p>{readOnlyNote(editable)}</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        {!hoursSet && <p className="mb-4 text-sm text-warning">Not set yet.</p>}
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
    </>,
  };
}
