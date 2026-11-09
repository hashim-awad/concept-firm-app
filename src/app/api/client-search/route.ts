import { NextResponse, type NextRequest } from "next/server";
import { getAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

// Ctrl+K search: clients whose legal name contains the text. Staff with client access only;
// row level security applies again in the database.
export async function GET(req: NextRequest) {
  const access = await getAccess();
  if (!access || !canView(access, "clients")) return NextResponse.json({ results: [] }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const supabase = await createClient();
  let query = supabase.from("clients").select("id, legal_name, kind, status").order("legal_name").limit(12);
  if (q) query = query.ilike("legal_name", `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const { data } = await query;
  return NextResponse.json({ results: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
