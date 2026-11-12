// Server helpers for the document screens: the screen settings and a saved document to reopen.
import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/access";
import { loadStudioData, type StudioData } from "./data";
import type { ScreenEnv } from "@/components/studio/kit";
import type { StudioClientRow } from "./controllers";

export async function screenSetup(supabase: SupabaseClient, access: Access, kind: "letter" | "proposal"): Promise<{ data: StudioData; env: ScreenEnv }> {
  const data = await loadStudioData(supabase, access);
  const env: ScreenEnv = {
    floors: data.floors, floorsOk: data.floorsOk, cat: data.cat, loaded: true,
    signer: kind === "proposal" ? data.signers.proposal : data.signers.letter,
    wording: data.wording,
    appRules: true,
    images: { LH: "/studio/letterhead.jpg", ILLUS: "/studio/illustrative-watermark.png", SIG: access.is_owner && data.signatureUploaded ? "/documents/signature" : "" },
  };
  return { data, env };
}

export const corporations = (rows: StudioClientRow[]) => rows.filter((c) => c["Entity type"] !== "Individual").sort((a, b) => String(a["Legal name"]).localeCompare(String(b["Legal name"])));
export const individuals = (rows: StudioClientRow[]) => rows.filter((c) => c["Entity type"] === "Individual").sort((a, b) => String(a["Legal name"]).localeCompare(String(b["Legal name"])));

// The latest saved inputs of a document, to keep working on it (a new version) or revise it.
export async function openDocument(supabase: SupabaseClient, id: string | undefined, kind: string) {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data: doc } = await supabase.from("documents").select("id, kind, client_id, current_version").eq("id", id).maybeSingle();
  if (!doc || doc.kind !== kind || !doc.current_version) return null;
  const { data: v } = await supabase.from("document_versions").select("inputs, mode").eq("document_id", id).eq("version", doc.current_version).maybeSingle();
  if (!v) return null;
  return { documentId: doc.id as string, clientId: (doc.client_id as string | null) ?? "", inputs: v.inputs as any, lastMode: v.mode as "draft" | "final" };
}
