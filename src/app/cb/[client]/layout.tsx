import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { canEdit, requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/books/server";
import { CbShell } from "../shell";

export default async function ClientLayout({ children, params }: { children: ReactNode; params: Promise<{ client: string }> }) {
  const access = await requireAccess("closebook", "view");
  const { client: id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const clients = await listClients(supabase);
  const client = clients.find((c) => c.id === id);
  if (!client) notFound();
  return <CbShell client={{ id: client.id, name: client.name }} clients={clients.map((c) => ({ id: c.id, name: c.name }))} canEdit={canEdit(access, "closebook")}>{children}</CbShell>;
}
