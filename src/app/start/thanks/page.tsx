import { CalendarClock, CheckCircle2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";

// Confirmation (batch sections 3 and 10): the quote arrives by email; never a promised time.
// Company call path: a short conversation, with the booking link from Settings.
export default async function ThanksPage({ searchParams }: PageProps<"/start/thanks">) {
  const sp = await searchParams;
  if (sp.r === "company" && sp.p === "call") {
    const { data } = await createAdminClient().from("settings").select("value").eq("key", "booking_link").maybeSingle();
    const link = typeof data?.value === "string" && data.value.startsWith("https://") ? data.value : "";
    return (
      <div className="text-center">
        <CalendarClock className="mx-auto h-12 w-12 text-navy-700" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Thank you.</h1>
        <p className="mt-3 text-ink-2">Your situation needs a short conversation so we quote it correctly. Choose a time below.</p>
        {link ? <a href={link} className="btn mt-6 inline-flex">Choose a time</a> : <p className="mt-6 text-sm text-ink-2">We will email you to set up a time.</p>}
      </div>
    );
  }
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
