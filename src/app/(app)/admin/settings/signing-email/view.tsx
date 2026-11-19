import { requireAdmin } from "@/lib/access";
import { SaveForm, SaveFormButton, SaveFormDiscard } from "@/components/save-state";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { saveSigningEmail } from "./actions";

// Email sending (Hashim, Nov 12, 2026): Studio sends the signing email from the issuing person's own
// Microsoft 365 mailbox. One switch per path. Admins only.
export async function SigningEmailView(sp: SP): Promise<View> {
  await requireAdmin();
  const { data } = await (await createClient()).rpc("signing_email_settings");
  const v = (data ?? {}) as { letters?: boolean; quotes?: boolean; proposals?: boolean };
  return {
    help: <>
      <p>Studio sends the signing email from the mailbox of the person who issues it, through Microsoft 365. A copy goes to their Sent folder. If sending fails, the Copy buttons on the page still work.</p>
      <h4>Quotes</h4>
      <p>The switches for T1, year-end and monthly quotes come after New letters are tested. Until then, staff copy their emails and send them from Outlook.</p>
      <p>The Test app only emails the firm&rsquo;s own addresses, never a client. Each staff mailbox must be allowed in Microsoft 365 (an application access policy) before it can send.</p>
      <p>Admins only.</p>
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <SaveForm action={saveSigningEmail} aria-label="Signing email" className="card grid max-w-xl gap-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="letters" defaultChecked={!!v.letters} className="mt-0.5 h-4 w-4 accent-navy-700" />
          <span><b>New letters.</b> Send the signing email when a letter is issued and sent for signing.</span>
        </label>
        <input type="hidden" name="quotes" value={v.quotes ? "on" : ""} /><input type="hidden" name="proposals" value={v.proposals ? "on" : ""} />
        <span className="inline-flex w-fit items-center gap-2"><SaveFormButton className="btn" /><SaveFormDiscard /></span>
      </SaveForm>
    </>,
  };
}
