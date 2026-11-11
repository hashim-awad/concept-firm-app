import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { forBrowser, loadPublished, readT1Rules } from "@/lib/screening/server";
import { taxYearFor } from "@/lib/screening/tax-year";
import { todayToronto } from "@/lib/dates";
import { PhoneLead, type PickClient } from "./phone-lead";

// Leads › New lead by phone (front office batch, section 2).
export default async function PhoneLeadPage() {
  const access = await requireAccess("leads", "edit");
  const supabase = await createClient();
  const [qn, rules, { data: rows }] = await Promise.all([
    loadPublished("personal"), readT1Rules(),
    canView(access, "clients") ? supabase.from("clients").select("id, kind, legal_name, signing_officer, email, province").eq("status", "active").order("legal_name").limit(2000) : Promise.resolve({ data: [] }),
  ]);
  const clients: PickClient[] = ((rows ?? []) as { id: string; kind: string; legal_name: string; signing_officer: string; email: string; province: string }[]).map((c) => {
    const person = (c.kind === "individual" ? c.legal_name : c.signing_officer || "").trim().split(/\s+/);
    return { id: c.id, name: c.legal_name, contact: { first_name: person[0] ?? "", last_name: person.slice(1).join(" "), email: c.email, phone: "", province: c.province === "OTHER" ? "" : c.province } };
  });
  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Leads</Link>
      <PageHeader title="New lead by phone" description="Enter the caller's answers in the same questions the client sees online. Their answers count as the client's; they do not redo them online." />
      <PhoneLead qn={qn ? forBrowser(qn) : null} rules={rules} taxYear={taxYearFor(todayToronto())} clients={clients} pricing={canView(access, "pricing")} />
    </>
  );
}
