import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@voxly/shared'],
  async rewrites() {
    const apiBase = process.env.SAAS_API_URL || 'http://saas-api:3001';
    return [
      { source: '/api/:path*', destination: `${apiBase}/:path*` },
    ];
  },
};

export default nextConfig;
