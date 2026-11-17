import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages that need a signed-in user are rendered fresh on every request.
  // Cache Components is left off on purpose: simpler to maintain, and nothing here
  // holds data that should be cached between users.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
  // pdfmake (Studio's PDF library) reads its font data files at run time; load it as is.
  // Round 20, the statement reader's file preparation (src/lib/statements/prepare.ts): qpdf (WebAssembly)
  // unlocks PDFs, heic-convert turns phone photos into JPEG, pngjs and jpeg-js read images. They load
  // their own files at run time, so they are required as is from node_modules, not bundled.
  serverExternalPackages: ["pdfmake", "@neslinesli93/qpdf-wasm", "heic-convert", "pngjs", "jpeg-js"],
  // prepare.ts finds qpdf.wasm by its path in node_modules, which the file tracer cannot see: add it (and
  // the photo converter) to the functions that read statements. The runner route reads them; the pages
  // whose server actions upload, retry or poll can run the reader too when the route cannot be reached.
  outputFileTracingIncludes: Object.fromEntries(["/api/statements/run", "/closebook/\\[id\\]", "/admin/bank-pdf", "/statements/\\[id\\]"].map((r) => [r, [
    "./node_modules/@neslinesli93/qpdf-wasm/dist/**/*",
    "./node_modules/heic-convert/**/*", "./node_modules/heic-decode/**/*", "./node_modules/libheif-js/**/*",
    "./node_modules/pngjs/**/*", "./node_modules/jpeg-js/**/*",
  ]])),
  // Signature image and the owner's Notion CSV imports are sent to server actions.
  // Vercel accepts request bodies up to 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // Round 32: the client's questions page is never indexed and never cached.
      { source: "/cq/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
