import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientShell } from "@/components/ds/client";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { pieceText } from "@/lib/t1-quote/render";
import { C, CORP, SIGN_PAGE } from "@/lib/t1-quote/wording";
import { firmSignature } from "@/lib/t1-quote/server";
import { isCompanyLetter, letterHtml, type LetterRow } from "@/lib/letters/server";

export const metadata: Metadata = { title: "Preview as client", robots: { index: false, follow: false } };

// Preview as client (Hashim, Nov 12, 2026): staff see a New letter exactly as the client's page shows
// it, signed in as staff and without the client's link, so the letter is never marked Viewed. Signing
// is off here.
export default async function LetterPreview({ params }: PageProps<"/letter-preview/[id]">) {
  await requireAccess("documents", "view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("id, kind, status, signer, wording, company_name, title, details").eq("id", id).maybeSingle();
  if (!q || q.kind !== "letter") notFound();
  const { data: s } = await supabase.from("quote_signers").select("first_name, last_name").eq("quote_id", id).order("person").limit(1);
  const letter = q as unknown as LetterRow;
  const texts = letter.wording ?? {};
  const html = letterHtml(letter, await firmSignature());
  const who = s?.[0] ? `${s[0].first_name} ${s[0].last_name}` : "";
  return (
    <ClientShell wide>
      <div className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
        <p><b>Preview as client.</b> This is the page the client sees. Signing is off, and opening it here does not mark the letter as viewed.</p>
        <Link href={`/engagement-letters/${id}`} className="btn-secondary">Back to the letter</Link>
      </div>
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-5 py-7 shadow-sm sm:px-12 sm:py-12" dangerouslySetInnerHTML={{ __html: html }} />
        <aside className="grid gap-4 rounded-lg border border-sand-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
          <p>{pieceText(texts, C.typeName, who)}</p>
          <div><p className="label">{pieceText(texts, C.fullName)}</p><div className="input bg-sand-50" /></div>
          {isCompanyLetter(letter) && <div><p className="label">{pieceText(texts, CORP.signerTitle)}</p><div className="input bg-sand-50" /></div>}
          <p className="text-sm text-ink-2">{pieceText(texts, SIGN_PAGE.agreeLetter)}</p>
          <button type="button" disabled className="btn w-fit opacity-60">{pieceText(texts, C.signButton)}</button>
        </aside>
      </div>
    </ClientShell>
  );
}
