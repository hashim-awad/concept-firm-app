"use server";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { saveClientFromDocument, saveDocument, type SaveInput, type SaveResult, type DocKind } from "@/lib/studio/save";

export async function saveDocumentAction(input: SaveInput): Promise<SaveResult> {
  const access = await getAccess();
  if (!access) return { ok: false, error: "Your session has ended. Sign in again." };
  return saveDocument(await createClient(), access, input);
}

export async function saveClientAction(input: { kind: DocKind; snapshot: unknown }) {
  const access = await getAccess();
  if (!access) return { ok: false as const, error: "Your session has ended. Sign in again." };
  return saveClientFromDocument(await createClient(), access, input.kind, input.snapshot);
}
