import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveRetention } from "../actions";

export async function RetentionView(sp: SP): Promise<View> {
  const { editable, byKey } = await loadSettings();
  const retention = Number(byKey.get("retention_months") ?? 24);
  return {
    help: <>
      <p>Lost and out-of-scope leads, with their screening answers, are deleted automatically this many months after they close. Signed documents and signing records are always kept.</p>
      <p>{readOnlyNote(editable)}</p>
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveRetention} className="card">
        <fieldset disabled={!editable} className="space-y-3">
          <legend className="sr-only">Retention</legend>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="months" className="label">Months</label>
              <input id="months" name="months" type="number" min={1} max={120} step={1} defaultValue={retention} required className="input w-28" />
            </div>
            {editable && <button type="submit" className="btn">Save retention</button>}
          </div>
        </fieldset>
      </form>
    </>,
  };
}
