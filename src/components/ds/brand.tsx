// Concept brand marks.
// <ConceptMark> is the "C" with the green chevron, drawn from the supplied logo (exact geometry).
// <Logo> uses the real wordmark image once /public/brand/concept-logo-*.svg|png exist.
// Until then it shows the mark plus a typed placeholder, marked data-placeholder.

export function ConceptMark({ size = 32, ring = "navy" }: { size?: number; ring?: "navy" | "white" | "black" }) {
  const ringColour = ring === "white" ? "#FFFFFF" : ring === "black" ? "#000000" : "var(--color-navy-700)";
  return (
    <svg width={size} height={(size * 1843) / 1674} viewBox="0 0 1674 1843" role="img" aria-label="Concept">
      <path d="M1673 388 A920 920 0 1 0 1673 1455 L1416 1338 A646 646 0 1 1 1416 504 Z" fill={ringColour} />
      <polygon points="932,535 1318,921 932,1308 741,1117 937,921 741,726" fill="var(--color-lime-500)" />
    </svg>
  );
}

export function Logo({ tone = "navy", size = "md" }: { tone?: "navy" | "white"; size?: "sm" | "md" | "lg" }) {
  const markSize = size === "lg" ? 40 : size === "sm" ? 24 : 32;
  const text = tone === "white" ? "text-white" : "text-navy-700";
  return (
    <span className={`inline-flex items-center gap-2.5 ${text}`} data-placeholder="wordmark" aria-label="Concept Accounting & Advisory">
      <ConceptMark size={markSize} ring={tone === "white" ? "white" : "navy"} />
      <span className="leading-none">
        <span className={`block font-bold tracking-tight ${size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl"}`}>Concept</span>
        {size !== "sm" && (
          <span className={`mt-1 block text-[10px] font-semibold tracking-[0.12em] uppercase ${tone === "white" ? "text-white/70" : "text-ink-3"}`}>
            Accounting &amp; Advisory
          </span>
        )}
      </span>
    </span>
  );
}

// Firm details for client pages and documents (public business information).
export const FIRM = {
  legalName: "Concept Accounting & Advisory Professional Corporation",
  address: "675 Riverbend Dr., Kitchener, ON N2K 3S3",
  phone: "226-789-9591",
  email: "contact@conceptaccounting.ca",
  web: "conceptaccounting.ca",
};
