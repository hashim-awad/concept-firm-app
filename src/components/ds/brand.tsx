import Image from "next/image";

// Concept brand marks.
// <ConceptMark> is the "C" with the green chevron, drawn from the supplied logo (exact geometry).
// <Logo> is the full supplied logo artwork (public/brand).

export function ConceptMark({ size = 32, ring = "navy" }: { size?: number; ring?: "navy" | "white" | "black" }) {
  const ringColour = ring === "white" ? "#FFFFFF" : ring === "black" ? "#000000" : "var(--color-navy-700)";
  return (
    <svg width={size} height={(size * 1843) / 1674} viewBox="0 0 1674 1843" role="img" aria-label="Concept">
      <path d="M1673 388 A920 920 0 1 0 1673 1455 L1416 1338 A646 646 0 1 1 1416 504 Z" fill={ringColour} />
      <polygon points="932,535 1318,921 932,1308 741,1117 937,921 741,726" fill="var(--color-lime-500)" />
    </svg>
  );
}

// Full Concept logo (supplied artwork). Navy on light backgrounds, white on navy.
const LOGO = {
  navy: { src: "/brand/concept-logo-navy.webp", w: 1500, h: 388 },
  white: { src: "/brand/concept-logo-white.webp", w: 2000, h: 517 },
};
export function Logo({ tone = "navy", height = 36, priority }: { tone?: "navy" | "white"; height?: number; priority?: boolean }) {
  const l = LOGO[tone];
  return (
    <Image src={l.src} alt="Concept Accounting & Advisory, Chartered Professional Accountants"
      width={Math.round((l.w / l.h) * height)} height={height} priority={priority} className="h-auto max-w-full" />
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
