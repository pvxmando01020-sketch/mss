/** @type {import('next').NextConfig} */
const API_URL = process.env.MSS_API_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
