import type { NextConfig } from "next";

/** Sent with every response. No full CSP yet: Next.js inline scripts would need nonces. */
const securityHeaders = [
  // Nobody can frame RoomSync to trick a click on "Delete", "Settle up" or "Remove".
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Reset links and calendar links carry secrets in the URL; never send the path elsewhere.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      // Receipts set their own strict headers; framing rules there could upset built-in PDF viewers.
      { source: "/((?!api/receipts/).*)", headers: securityHeaders },
      // The service worker must always be re-checked so fixes reach installed apps.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      { source: "/manifest.webmanifest", headers: [{ key: "Content-Type", value: "application/manifest+json" }] },
    ];
  },
};

export default nextConfig;
