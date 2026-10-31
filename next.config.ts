import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["playwright", "pdfjs-dist"],
  poweredByHeader: false,
  devIndicators: false,
  logging: {
    incomingRequests: { ignore: [/\/api\/integrations\/callback\//, /\/api\/auth\/callback/] },
  },
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./.data/**/*",
      "./tests/**/*",
      "./e2e/**/*",
      "./test-results/**/*",
      "./playwright-report/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default config;
