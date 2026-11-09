import { PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/access";
import { formatDate } from "@/lib/dates";
import { CHANGELOG } from "@/lib/changelog";

// What changed in the app, in plain words, newest first (standing rule 1.2).
export default async function ChangelogPage() {
  await requireAccess();
  return (
    <>
      <PageHeader title="Change log" description="What changed in Concept Studio, newest first." />
      <div className="grid max-w-3xl gap-4">
        {CHANGELOG.map((c, i) => (
          <section key={i} className="card">
            <p className="text-xs text-muted">{formatDate(c.date)}</p>
            <h2 className="mb-2 font-semibold">{c.title}</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">{c.points.map((p, j) => <li key={j}>{p}</li>)}</ul>
          </section>
        ))}
      </div>
    </>
  );
}
