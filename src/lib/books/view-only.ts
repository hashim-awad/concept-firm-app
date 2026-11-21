// CB2-1 PR B (Hashim, Nov 21, 2026): until the switch-over, the opening balances, opening difference and trial balance
// import entries are view-only in Books: their window shows the lines, Audit history and the Transaction journal, with no
// Save, Reverse, Copy or Delete. Ordinary entries are unchanged. The window and the Delete action both ask here.
export const VIEW_ONLY_ORIGINS = ["opening_balances", "opening_difference", "tb_import"] as const;
export const VIEW_ONLY_TEXT = "Change this entry in the old Closebook until the switch-over.";

export function entryActions(e: { origin?: string | null; generated?: boolean }, canEdit: boolean) {
  const viewOnly = !!e.generated || (VIEW_ONLY_ORIGINS as readonly string[]).includes(e.origin ?? "");
  const act = canEdit && !viewOnly;
  return { viewOnly, readOnly: !canEdit || viewOnly, save: act, reverse: act, copy: act, delete: act };
}
