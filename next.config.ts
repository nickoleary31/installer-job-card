import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.141", "10.199.96.137", "192.168.1.217", "192.168.1.162", "idiocy-untidy-fester.ngrok-free.dev"],
  // sharp ships a platform-specific native binary (libvips) — without this, Turbopack tries to
  // bundle it instead of treating it as external/native, which breaks the binding at runtime
  // (ERR_DLOPEN_FAILED on Vercel's linux-x64 functions) and makes /api/send-email fail instantly
  // on its first photo-optimize call.
  serverExternalPackages: ["sharp"],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With" },
        ],
      },
    ];
  },
};

export default nextConfig;
