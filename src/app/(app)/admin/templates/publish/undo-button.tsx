"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoWording } from "../actions";

export function UndoButton({ wordingKey }: { wordingKey: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await undoWording(wordingKey); router.refresh(); })} className="text-sm text-navy-700 underline disabled:opacity-50">
      {pending ? "Undoing..." : "Undo this change"}
    </button>
  );
}
