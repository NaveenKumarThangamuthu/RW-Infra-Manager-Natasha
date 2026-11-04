/** @type {import('next').NextConfig} */
const INFRA_BACKEND = process.env.INFRA_BACKEND_URL || "";

const nextConfig = {
  reactStrictMode: true,
  // Heavy server-only deps that don't need webpack bundling.
  experimental: {
    serverComponentsExternalPackages: ["playwright-core", "@prisma/client"],
  },
  async rewrites() {
    // Reverse-proxy only when the Spring Boot backend URL is explicitly set.
    // Until then, /security/* is served by native Next.js pages (Phase 5 MVP).
    if (!INFRA_BACKEND) return [];
    return [
      { source: "/api/security/:path*", destination: `${INFRA_BACKEND}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
