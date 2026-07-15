import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@voxly/shared'],
  async rewrites() {
    // Server-side proxy target (Docker network). Browser calls stay on /api/*.
    const apiBase = process.env.SAAS_API_URL || 'http://saas-api:3002';
    return [
      { source: '/api/:path*', destination: `${apiBase}/api/:path*` },
    ];
  },
};

export default nextConfig;
