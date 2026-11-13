import Link from "next/link";

// A page that does not exist, inside Studio's frame with the menu (round 4 item 8).
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-sm font-semibold tracking-wide text-ink-3 uppercase">Page not found</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">This page does not exist.</h1>
      <p className="mt-2 text-ink-2">The address may be mistyped, or the page may have moved.</p>
      <Link href="/" className="btn mt-6">Back to My day</Link>
    </div>
  );
}
