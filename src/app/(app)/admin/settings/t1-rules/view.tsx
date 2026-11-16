import { Notice } from "@/components/ui";
import { SaveForm, SaveFormButton, SaveFormDiscard } from "@/components/save-state";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveT1Rules } from "../actions";

export async function T1RulesView(sp: SP): Promise<View> {
  const { access, editable, byKey } = await loadSettings();
  const t1 = (byKey.get("t1_rules") ?? {}) as { moving_km?: number; t1135_simple_over?: number; t1135_detailed_from?: number; checked_on?: string };
  return {
    help: <>
      <p>Used by the personal tax screening questions. Check them on canada.ca when CRA changes a rule.</p>
      <p>Only an owner can change them.</p>
      <p>{readOnlyNote(editable)}</p>
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <SaveForm action={saveT1Rules} aria-label="T1 rules" className="grid gap-3 sm:grid-cols-2">
          <fieldset disabled={!access.is_owner} className="contents">
            <div><label htmlFor="moving_km" className="label">Moving expenses: minimum distance closer (km)</label><input id="moving_km" name="moving_km" inputMode="numeric" defaultValue={t1.moving_km ?? ""} className="input" /></div>
            <div><label htmlFor="checked_on" className="label">Checked on canada.ca on</label><input id="checked_on" name="checked_on" type="date" defaultValue={t1.checked_on ?? ""} className="input" /></div>
            <div><label htmlFor="t1135_simple_over" className="label">T1135 needed when foreign property cost more than ($)</label><input id="t1135_simple_over" name="t1135_simple_over" inputMode="numeric" defaultValue={t1.t1135_simple_over ?? ""} className="input" /></div>
            <div><label htmlFor="t1135_detailed_from" className="label">T1135 detailed method when cost was at least ($)</label><input id="t1135_detailed_from" name="t1135_detailed_from" inputMode="numeric" defaultValue={t1.t1135_detailed_from ?? ""} className="input" /></div>
            {access.is_owner && <div className="sm:col-span-2"><span className="inline-flex w-fit items-center gap-2"><SaveFormButton className="btn" /><SaveFormDiscard /></span></div>}
          </fieldset>
        </SaveForm>
      </section>
    </>,
  };
}
