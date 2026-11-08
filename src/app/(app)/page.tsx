import Link from "next/link";
import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canEdit, canView } from "@/lib/access";
import { messageFrom } from "@/lib/messages";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const access = await requireAccess();
  const sp = await searchParams;
  const firstName = access.full_name.split(" ")[0];
  const make = canEdit(access, "documents");
  const links: [string, string, string, boolean][] = [
    ["/documents/corporate-letter", "Corporate letter", "One letter per corporate client, with its service schedules.", make],
    ["/documents/t1-letter", "T1 letter", "Personal tax letters for owners of company clients.", make],
    ["/documents/proposal", "Proposal", "Up to three options. The accepted one becomes the letter.", make],
    ["/t1-pricing", "T1 pricing", "Price a standalone personal tax return.", make],
    ["/documents", "Documents", "Engagements, proposals and every PDF in the vault.", canView(access, "documents") || canView(access, "vault")],
    ["/clients", "Clients", "Client records and the legal name check.", canView(access, "clients")],
  ];
  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description="Letters, proposals and the price book, with the same wording and checks as Concept Studio (EL v3.31)." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.filter((l) => l[3]).map(([href, title, body]) => (
          <Link key={href} href={href} className="card block transition-colors hover:border-navy-300">
            <h2 className="mb-1 font-semibold text-navy-800">{title}</h2>
            <p className="text-sm text-muted">{body}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
