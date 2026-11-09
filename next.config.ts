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
  serverExternalPackages: ["pdfmake"],
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
    ];
  },
};

export default nextConfig;
