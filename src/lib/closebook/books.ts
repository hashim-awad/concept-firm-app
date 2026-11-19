// Files whose client keeps their own books (Hashim, Nov 15, 2026): full files on the client's own
// QuickBooks or Xero, or a bookkeeper's file. Their entries go to the client to record.
export const keepsOwnBooks = (f: { file_type: string; books: string }) => f.file_type === "full" && (f.books === "client_software" || f.books === "bookkeeper");
// Piece R2 (D12a, D12e; Hashim, Nov 19, 2026): every trial balance file takes Closebook entries and gets the client entry list,
// to book in QuickBooks. keepsOwnBooks stays as it is (the year-end package, the documents zip and the shareholder loans).
export const takesClientEntryList = (f: { books: string }) => f.books !== "statements" && f.books !== "paper";
// On Concept's monthly QuickBooks files Concept books the entries itself: the list is titled for that.
export const clientListTitle = (f: { books: string }) => (f.books === "concept_qbo" ? "Entries to record in QuickBooks" : "Entries to record in your books");
