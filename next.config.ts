import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs (XLSX dos relatórios) é CommonJS pesado, usado só em Route Handlers: carrega do node_modules em vez de entrar no bundle.
  serverExternalPackages: ["exceljs"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-**",
      },
    ],
  },
  async headers() {
    return [
      {
        // O token do convite está no path: não vazar por Referer nem ficar em cache.
        source: "/convite/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
