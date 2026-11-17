import { Notice } from "@/components/ui";
import { SaveForm, SaveFormButton, SaveFormDiscard } from "@/components/save-state";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveFirmContact } from "../actions";

// Round 33 (Hashim, Nov 17, 2026): the firm's address, phone and email on every client page footer and message.
export async function ContactView(sp: SP): Promise<View> {
  const { access, editable, byKey } = await loadSettings();
  const c = (byKey.get("firm_contact") ?? {}) as { address?: string; phone?: string; email?: string };
  const unset = !c.address || !c.phone || !c.email;
  return {
    help: <><p>Shown to clients on their pages: the footer of the questions page, quotes and engagement letters, and the start form. Only an owner can change these.</p><p>{readOnlyNote(editable)}</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        {unset && <p className="mb-4 text-sm text-warning" data-contact-unset>Not set yet. Client pages show only the firm&rsquo;s name until these are filled in.</p>}
        <SaveForm action={saveFirmContact} aria-label="Firm contact details" className="grid max-w-xl gap-3">
          <fieldset disabled={!access.is_owner} className="grid gap-3">
            <label className="grid gap-1"><span className="label">Address</span><input name="address" defaultValue={c.address ?? ""} maxLength={200} className="input" placeholder="Street, city, province, postal code" /></label>
            <label className="grid gap-1"><span className="label">Phone</span><input name="phone" defaultValue={c.phone ?? ""} maxLength={25} className="input" /></label>
            <label className="grid gap-1"><span className="label">Email</span><input name="email" type="email" defaultValue={c.email ?? ""} maxLength={120} className="input" /></label>
            {access.is_owner && <span className="inline-flex w-fit items-center gap-2"><SaveFormButton className="btn" /><SaveFormDiscard /></span>}
          </fieldset>
        </SaveForm>
      </section>
    </>,
  };
}
