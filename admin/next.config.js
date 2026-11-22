/** @type {import('next').NextConfig} */
// The console is its own app so the two agents working in the site never have to
// merge around these files. It speaks to the same Django API through the same
// trick: a first-party proxy, so the auth cookies stay on this origin.
//
// EXPOSING_API_ORIGIN is set per environment. Locally, point it at whichever API
// process carries the adminpanel routes — the console needs 8003 if the shared
// 8001 has not been restarted since those endpoints landed.
const API_ORIGIN = process.env.EXPOSING_API_ORIGIN || 'http://127.0.0.1:8001';

const nextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/media/:path*', destination: `${API_ORIGIN}/media/:path*` },
    ];
  },
};

module.exports = nextConfig;
