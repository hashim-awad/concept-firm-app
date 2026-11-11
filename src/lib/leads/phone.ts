// New lead by phone (front office batch, section 2): what the staff-mode screening shares with the
// pages around it. Pure.
export type Finish = "issue" | "draft" | "hashim";
export type PhoneContact = { first_name: string; last_name: string; email: string; phone: string; province: string };
export const FINISH_LABEL: Record<Finish, string> = { issue: "Issue quote", draft: "Save as draft", hashim: "Send to Hashim" };
export const PHONE_ANSWERS_NOTE = "These are the caller's answers, entered by staff on the call. They count as the client's answers.";
