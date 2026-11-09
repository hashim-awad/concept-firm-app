import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveSigner } from "../actions";

const SIGNERS: [string, string, string][] = [
  ["signer_engagement_letter", "Engagement letters", "Corporate and T1 letters. Use the name registered with CPA Ontario."],
  ["signer_proposal", "Proposals", "The name on proposals."],
  ["signer_other", "Everything else", "Other documents the app makes."],
];

export default async function SignersPage({ searchParams }: PageProps<"/admin/settings/signers">) {
  const { access, editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const signer = (k: string) => (byKey.get(k) ?? { name: "", title: "Director" }) as { name: string; title: string };
  return (
    <>
      <PageHeader title="Signer names" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <p className="mb-4 text-sm text-muted">The name and title printed in the signature block. Only an owner can change these.</p>
        <div className="grid gap-5">
          {SIGNERS.map(([key, label, hint]) => (
            <form key={key} action={saveSigner} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="key" value={key} />
              <div>
                <label htmlFor={`${key}-name`} className="label">{label}</label>
                <input id={`${key}-name`} name="name" defaultValue={signer(key).name} disabled={!access.is_owner} className="input" />
                <span className="text-xs text-muted">{hint}</span>
              </div>
              <div>
                <label htmlFor={`${key}-title`} className="label">Title</label>
                <input id={`${key}-title`} name="title" defaultValue={signer(key).title} disabled={!access.is_owner} className="input" />
                <span className="text-xs">&nbsp;</span>
              </div>
              {access.is_owner && <button type="submit" className="btn mb-5">Save</button>}
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
