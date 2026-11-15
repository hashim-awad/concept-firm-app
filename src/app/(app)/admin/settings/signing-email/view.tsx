import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { saveSigningEmail } from "./actions";

// Email sending (Hashim, Nov 12, 2026): Studio sends the signing email from the issuing person's own
// Microsoft 365 mailbox. One switch per path. Owners only.
export async function SigningEmailView(sp: SP): Promise<View> {
  await requireOwner();
  const { data } = await (await createClient()).rpc("signing_email_settings");
  const v = (data ?? {}) as { letters?: boolean; quotes?: boolean; proposals?: boolean };
  return {
    help: <>
      <p>Studio sends the signing email from the mailbox of the person who issues it, through Microsoft 365. A copy goes to their Sent folder. If sending fails, the Copy buttons on the page still work.</p>
      <h4>Quotes and proposals</h4>
      <p>Their switches come after New letters are tested. Until then, staff copy their emails and send them from Outlook.</p>
      <p>The Test app only emails the firm&rsquo;s own addresses, never a client. Each staff mailbox must be allowed in Microsoft 365 (an application access policy) before it can send.</p>
      <p>Owners only.</p>
    </>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveSigningEmail} className="card grid max-w-xl gap-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="letters" defaultChecked={!!v.letters} className="mt-0.5 h-4 w-4 accent-navy-700" />
          <span><b>New letters.</b> Send the signing email when a letter is issued and sent for signing.</span>
        </label>
        <input type="hidden" name="quotes" value={v.quotes ? "on" : ""} /><input type="hidden" name="proposals" value={v.proposals ? "on" : ""} />
        <button type="submit" className="btn w-fit">Save</button>
      </form>
    </>,
  };
}
