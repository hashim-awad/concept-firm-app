import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ScreeningForm } from "@/components/screening-form";
import { requireAccessWithPricing } from "@/lib/access";
import { loadQuestionnaire, toEngine } from "@/lib/screening/load";
import { tryQuestionnaire } from "./actions";

export default async function TryPage({ params }: PageProps<"/admin/screening/[id]/try">) {
  await requireAccessWithPricing("price_book", "view");
  const { id } = await params;
  const qn = await loadQuestionnaire(id);
  if (!qn) notFound();
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`/admin/screening/${id}`} className="text-accent underline">Back to version {qn.row.version}</Link></p>
      <PageHeader title={`Try it: ${qn.row.route}, version ${qn.row.version}`} description="Answer as a client would. You see the quote the rules would build, using today's prices. Nothing is saved." />
      <div className="max-w-3xl">
        <ScreeningForm
          qn={{ ...toEngine(qn), title: qn.row.title, intro: qn.row.intro }}
          action={tryQuestionnaire.bind(null, id)}
          submitLabel="Show the quote"
          showPrices
        />
      </div>
    </>
  );
}
