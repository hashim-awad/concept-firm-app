import "server-only";
// Round 33 (Hashim, Nov 17, 2026): the firm's address, phone and email for client pages come from Studio's settings
// (Settings › Firm details › Contact, Admins only), never from code. Read with the server key: client pages have no session.
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

export type FirmContact = { address: string; phone: string; email: string };
export const loadFirmContact = cache(async (): Promise<FirmContact> => {
  try {
    const { data, error } = await createAdminClient().from("settings").select("value").eq("key", "firm_contact").maybeSingle();
    if (error) { console.error(`[firm contact] ${error.message}`); return { address: "", phone: "", email: "" }; }
    const v = (data?.value ?? {}) as Partial<FirmContact>;
    return { address: v.address ?? "", phone: v.phone ?? "", email: v.email ?? "" };
  } catch (e) {
    console.error(`[firm contact] ${e instanceof Error ? e.message : e}`);
    return { address: "", phone: "", email: "" };
  }
});
// "call us at 226-…" or "contact us" when the setting is not filled in yet.
export const callUs = (c: FirmContact) => (c.phone ? `call us at ${c.phone}` : c.email ? `email us at ${c.email}` : "contact us");
