import { CheckCircle2 } from "lucide-react";

// Confirmation (batch section 3): the quote arrives by email; never a promised time.
export default async function ThanksPage({ searchParams }: PageProps<"/start/thanks">) {
  const sp = await searchParams;
  const review = sp.o === "1";
  return (
    <div className="text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Thank you. We have your answers.</h1>
      <p className="mt-3 text-ink-2">{review
        ? "Your situation needs a closer look. A member of our team will review your answers and contact you."
        : "A member of our team will review them and email you your quote."}</p>
    </div>
  );
}
