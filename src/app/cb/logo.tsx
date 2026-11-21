import Image from "next/image";

// The Closebook logo (Hashim, Nov 21, 2026): navy on light, white on the navy bar; the icon alone when folded.
export function CbLogo({ tone = "white", height = 26 }: { tone?: "navy" | "white"; height?: number }) {
  const src = tone === "white" ? "/brand/closebook-logo-white.svg" : "/brand/closebook-logo.svg";
  return <Image src={src} alt="Closebook" width={Math.round((459 / 140) * height)} height={height} unoptimized priority className="block" style={{ height, width: "auto" }} />;
}
