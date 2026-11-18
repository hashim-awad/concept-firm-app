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

// The C Studio logo (Hashim, Nov 18, 2026): the app's own name and logo on staff screens. The supplied SVGs,
// already outlined (no font), used as they are: navy #142E64, green #86BC25, white. Client-facing pages and
// documents use the firm's logo (<Logo>), never this one. (Staff emails still use the PNG in public/brand.)
const STUDIO = { white: "/brand/c-studio-white-500.svg", navy: "/brand/c-studio-navy-500.svg", w: 541.87, h: 134.96 };
export function StudioLogo({ tone = "navy", height = 40, priority }: { tone?: "navy" | "white"; height?: number; priority?: boolean }) {
  return (
    <Image src={STUDIO[tone]} alt="Concept Studio" width={Math.round((STUDIO.w / STUDIO.h) * height)} height={height} priority={priority} unoptimized
      className="block max-w-full" style={{ height, width: "auto" }} data-studio-logo={tone} />
  );
}
// The C on its own (the folded menu).
export function StudioMark({ tone = "white", size = 32 }: { tone?: "navy" | "white"; size?: number }) {
  return <Image src={`/brand/c-mark-${tone}.svg`} alt="Concept Studio" width={size} height={size} unoptimized className="block" data-studio-mark={tone} />;
}

// The browser tab icons for staff screens (client pages keep the Concept icon, src/app/icon.svg). The SVG turns
// its navy ring white on a dark browser; the PNGs (16, 32, 48 px) come in navy and, for dark mode, white.
export const STUDIO_ICONS = {
  icon: [
    { url: "/brand/studio-icon.svg", type: "image/svg+xml" },
    ...[16, 32, 48].map((s) => ({ url: `/brand/studio-icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png", media: "(prefers-color-scheme: light)" })),
    ...[16, 32, 48].map((s) => ({ url: `/brand/studio-icon-dark-${s}.png`, sizes: `${s}x${s}`, type: "image/png", media: "(prefers-color-scheme: dark)" })),
  ],
  apple: [{ url: "/brand/studio-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
};

// The firm's name for client pages and documents. Its address, phone and email are not here: they come from Settings ›
// Firm details › Contact (round 33, src/lib/firm-contact.ts).
export const FIRM = {
  legalName: "Concept Accounting & Advisory Professional Corporation",
  web: "conceptaccounting.ca",
};
