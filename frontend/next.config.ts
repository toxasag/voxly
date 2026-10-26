import type { NextConfig } from "next";

// standalone обязателен для production-Docker: `next build` выдаёт
// самодостаточный server.js, который раннер-образ запускает без next-cli.
const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;