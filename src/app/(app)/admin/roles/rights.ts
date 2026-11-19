// Piece R3a-1 (Hashim, Nov 19, 2026): the Closebook switches on a role. Wording approved by Hashim.
export const CB_SWITCHES = [
  { key: "prepare", col: "cb_prepare", label: "Prepare", hint: "Work the steps and sign the preparer circle." },
  { key: "review", col: "cb_review", label: "Review", hint: "Sign the reviewer circle and add review notes." },
  { key: "partner", col: "cb_partner", label: "Partner sign-off", hint: "Sign the partner circle (steps 1, 9 and 10).", later: "Applies from R3a-2" },
  { key: "lock", col: "cb_lock", label: "Lock and unlock", hint: "Lock a finished file, and reopen a locked file with a reason. Logged in History." },
  { key: "remove_signoffs", col: "cb_remove_signoffs", label: "Remove others' sign-offs", hint: "Take back a sign-off made by someone else. Logged in History." },
] as const;
export type CbSwitchKey = (typeof CB_SWITCHES)[number]["key"];
export type CbCol = (typeof CB_SWITCHES)[number]["col"];
// Admin: Edit on Staff accounts and Settings.
export const ADMIN_AREAS = ["staff_accounts", "settings"] as const;
export const isAdminRole = (perms: { area_key: string; level: string }[] | undefined) =>
  ADMIN_AREAS.every((k) => perms?.some((p) => p.area_key === k && p.level === "edit"));
