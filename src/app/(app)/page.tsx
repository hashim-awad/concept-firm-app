import { PageHeader, Notice } from "@/components/ui";
import { requireAccess } from "@/lib/access";
import { messageFrom } from "@/lib/messages";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const access = await requireAccess();
  const sp = await searchParams;
  const firstName = access.full_name.split(" ")[0];
  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description="This is the firm's app. More areas are added as they are built." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="card">
        <h2 className="mb-2 font-semibold">Coming next</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Price book and screening questions</li>
          <li>Public start page and leads</li>
          <li>Quotes, signing and the document vault</li>
        </ul>
      </div>
    </>
  );
}
