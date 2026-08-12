import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the Azure Container Apps image.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Hide the dev-only on-screen indicator (keeps captured UI clean).
  devIndicators: false,
  experimental: {
    optimizePackageImports: ["gsap"],
    // Server Actions compare the `origin` header against `x-forwarded-host` to
    // block CSRF. A dev tunnel (Codespaces, VS Code port forwarding) rewrites
    // the host, so the two legitimately disagree and every action 500s with
    // "Invalid Server Actions request". DEV ONLY — in Container Apps the two
    // already agree, so production keeps the check exactly as it was.
    ...(process.env.NODE_ENV === "production"
      ? {}
      : {
          serverActions: {
            // Matched against `new URL(origin).host`, so the port belongs here.
            allowedOrigins: ["localhost:3000", "127.0.0.1:3000", "*.app.github.dev", "*.githubpreview.dev"],
          },
        }),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
