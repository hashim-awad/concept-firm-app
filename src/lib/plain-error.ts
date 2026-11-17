// Round 26 (Hashim, Nov 17, 2026): a database error never reaches the screen. The rules in the database speak in
// plain words (private.require); anything else (a constraint, a missing function, a type error) is a fault on our
// side. The person sees one plain sentence; the raw text goes to the server log for us.
const RAW = /violates|constraint|relation "|column "|schema cache|syntax error|does not exist|duplicate key|null value in column|invalid input syntax|permission denied for|out of range|deadlock|could not serialize|PGRST|JWT|fetch failed/i;
export const FAULT = "Nothing was changed. Something went wrong on our side. Try again, and tell Hashim if it happens again.";
export function plainError(message: string): string {
  if (!RAW.test(message)) return message;
  console.error("[plain-error] raw database error hidden from the screen:", message);
  return FAULT;
}
