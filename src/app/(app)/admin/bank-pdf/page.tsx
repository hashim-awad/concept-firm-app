import { requireAccess } from "@/lib/access";
import { listStatements } from "@/lib/statements/server";
import { SettingsShell } from "../settings-shell";
import { StatementImport } from "../../statements/statement-upload";

// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026): gear > Tools. Bank and card statements,
// many at once, each read in the background; checked on the same Verify screen as Closebook step 3, then
// downloaded as CSV or Excel. No client file: the PDF and its lines are deleted after the download (only
// a log row of who, when, pages and cost is kept). Anyone with Closebook view can use it.
export default async function BankPdfPage() {
  await requireAccess("closebook", "view");
  const rows = await listStatements(null);
  return (
    <SettingsShell title="Bank statement PDF to CSV"
      help={<p>Upload bank and credit card statements as PDF or photos. Each one is read in the background. Check each statement on the Verify screen: the difference must be 0.00 before it can be downloaded. Files are deleted after you download them.</p>}>
      <div className="-mt-4 mb-5 grid gap-1">
        <p className="text-sm text-ink-2">Bank and credit card statements. Download as CSV or Excel.</p>
        <p className="text-sm font-medium text-ink">Files are deleted after you download them.</p>
      </div>
      <StatementImport fileId={null} initial={rows} canEdit standalone />
    </SettingsShell>
  );
}
