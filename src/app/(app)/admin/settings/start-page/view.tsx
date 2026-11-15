import Link from "next/link";
import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveStartPage } from "../actions";

export async function StartPageView(sp: SP): Promise<View> {
  const { access, editable, byKey } = await loadSettings();
  const startOpen = byKey.get("start_page_open") === true;
  const status = <span className={startOpen ? "font-medium text-success" : "text-muted"}>Now: {startOpen ? "open" : "closed"}</span>;
  return {
    help: <>
      <p>The page clients use to ask for a quote: <Link href="/start" className="text-navy-700 underline">/start</Link>. While closed, only signed-in staff can see it. Open it when the screening questions are ready.</p>
      <p>Only an owner can open or close it.</p>
      <p>{readOnlyNote(editable)}</p>
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        {access.is_owner ? (
          <form action={saveStartPage} className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="open" defaultChecked={startOpen} className="h-4 w-4 accent-navy-700" />Open to the public</label>
            <button type="submit" className="btn-secondary">Save</button>
            {status}
          </form>
        ) : <p className="text-sm">{status}</p>}
      </section>
    </>,
  };
}
