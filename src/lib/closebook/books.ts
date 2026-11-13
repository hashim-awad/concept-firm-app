// Files whose client keeps their own books (Hashim, Nov 15, 2026): full files on the client's own
// QuickBooks or Xero, or a bookkeeper's file. Their entries go to the client to record.
export const keepsOwnBooks = (f: { file_type: string; books: string }) => f.file_type === "full" && (f.books === "client_software" || f.books === "bookkeeper");
