import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { saveSigningEmail } from "./actions";

// Settings › Letters and signing › Signing emails (Hashim, Nov 12, 2026): Studio sends the signing
// email from the issuing person's own Microsoft 365 mailbox. One switch per path. Owners only.
export default async function SigningEmailPage({ searchParams }: PageProps<"/admin/settings/signing-email">) {
  await requireOwner();
  const sp = await searchParams;
  const { data } = await (await createClient()).rpc("signing_email_settings");
  const v = (data ?? {}) as { letters?: boolean; quotes?: boolean; proposals?: boolean };
  return (
    <>
      <PageHeader eyebrow="Settings › Letters and signing · owners only" title="Signing emails"
        description="Studio sends the signing email from the mailbox of the person who issues it, through Microsoft 365. A copy goes to their Sent folder. If sending fails, the Copy buttons on the page still work." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveSigningEmail} className="card grid max-w-xl gap-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="letters" defaultChecked={!!v.letters} className="mt-0.5 h-4 w-4 accent-navy-700" />
          <span><b>New letters.</b> Send the signing email when a letter is issued and sent for signing.</span>
        </label>
        <input type="hidden" name="quotes" value={v.quotes ? "on" : ""} /><input type="hidden" name="proposals" value={v.proposals ? "on" : ""} />
        <p className="text-sm text-ink-3"><b>Quotes and proposals.</b> Their switches come after New letters are tested. Until then, staff copy their emails and send them from Outlook.</p>
        <p className="text-xs text-muted">The Test app only emails the firm&rsquo;s own addresses, never a client. Each staff mailbox must be allowed in Microsoft 365 (an application access policy) before it can send.</p>
        <button type="submit" className="btn w-fit">Save</button>
      </form>
    </>
  );
}
