import "server-only";
// Loads a T1 quote for the staff page (signed-in, Pricing and Leads) or for the client's private
// link (server key, by token), and turns it into the data the renderer needs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayToronto } from "@/lib/dates";
import type { QuoteData } from "./render";

export type QuoteRow = {
  id: string; lead_id: string; tax_year: number; couple: boolean; lines: { code: string; person: number | null; quantity: number; unit_cents: number; total_cents: number }[];
  total_cents: number; status: "draft" | "sent" | "signed"; sent_at: string | null; valid_until: string | null;
  sender: { name: string; phone: string; email: string } | null; signer: { name: string; title: string } | null;
  wording: Record<string, string> | null; wording_label: string | null;
};
export type SignerRow = { person: number; first_name: string; last_name: string; email: string; token: string; signed_at: string | null };

const COLS = "id, lead_id, tax_year, couple, lines, total_cents, status, sent_at, valid_until, sender, signer, wording, wording_label";

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function toQuoteData(q: QuoteRow, signers: SignerRow[], fallback: { preparedBy: string; signer: { name: string; title: string } }): QuoteData {
  const s0 = signers.find((s) => s.person === 0), s1 = signers.find((s) => s.person === 1);
  return {
    taxYear: q.tax_year,
    client: { first: s0?.first_name ?? "", last: s0?.last_name ?? "" },
    spouse: q.couple && s1 ? { first: s1.first_name, last: s1.last_name } : null,
    lines: q.lines.map((l) => ({ code: l.code, person: l.person, quantity: l.quantity })),
    totalCents: q.total_cents,
    preparedBy: q.sender?.name ?? fallback.preparedBy,
    preparedOn: q.sent_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(q.sent_at)) : todayToronto(),
    validUntil: q.valid_until ?? addDays(todayToronto(), 21),
    signer: q.signer?.name ? q.signer : fallback.signer,
  };
}

export async function loadQuoteForStaff(supabase: SupabaseClient, leadId: string) {
  const { data: q } = await supabase.from("t1_quotes").select(COLS).eq("lead_id", leadId).maybeSingle();
  if (!q) return null;
  const { data: s } = await supabase.from("t1_quote_signers").select("person, first_name, last_name, email, token, signed_at").eq("quote_id", q.id).order("person");
  return { quote: q as QuoteRow, signers: (s ?? []) as SignerRow[] };
}

// The engagement-letter signer from Settings (read with the server key; not every role reads Settings).
export async function letterSigner(): Promise<{ name: string; title: string }> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "signer_engagement_letter").maybeSingle();
  const v = (data?.value ?? {}) as { name?: string; title?: string };
  return { name: v.name ?? "", title: v.title ?? "" };
}

// The client's view, by private link. Only a sent (or signed) quote opens.
export async function loadQuoteByToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const db = createAdminClient();
  const { data: me } = await db.from("t1_quote_signers").select("quote_id, person, first_name, last_name, email, token, signed_at").eq("token", token).maybeSingle();
  if (!me) return null;
  const [{ data: q }, { data: s }] = await Promise.all([
    db.from("t1_quotes").select(COLS).eq("id", me.quote_id).maybeSingle(),
    db.from("t1_quote_signers").select("person, first_name, last_name, email, token, signed_at").eq("quote_id", me.quote_id).order("person"),
  ]);
  if (!q) return null;
  return { quote: q as QuoteRow, signers: (s ?? []) as SignerRow[], me: me as SignerRow & { quote_id: string } };
}
