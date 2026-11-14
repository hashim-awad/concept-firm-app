"use client";
// Print preview: the browser's print dialog on the page shown (the file's header, tabs and panels are
// left out of the print).
export function PrintNow() {
  return <button type="button" onClick={() => window.print()} className="block w-full rounded px-2 py-1 text-left hover:bg-sand-100">Print preview</button>;
}
