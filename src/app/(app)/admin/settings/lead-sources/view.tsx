import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveLeadSources } from "../actions";

export async function LeadSourcesView(sp: SP): Promise<View> {
  const { editable, byKey } = await loadSettings();
  const sources = (byKey.get("lead_sources") ?? []) as string[];
  return {
    help: <><p>The choices for &ldquo;How did you hear about us?&rdquo; and the Source on each lead. One per line.</p><p>{readOnlyNote(editable)}</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <form action={saveLeadSources} className="grid max-w-md gap-2">
          <textarea name="sources" rows={8} defaultValue={sources.join("\n")} disabled={!editable} aria-label="Lead sources, one per line" className="input" />
          {editable && <button type="submit" className="btn-secondary w-fit">Save lead sources</button>}
        </form>
      </section>
    </>,
  };
}
