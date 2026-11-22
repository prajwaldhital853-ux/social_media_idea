/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.EXPOSING_API_ORIGIN || 'http://127.0.0.1:8001';

const nextConfig = {
  reactStrictMode: true,
  // The API is Django and wants trailing slashes; let its own slash handling
  // through instead of rewriting /api/x/ to /api/x first.
  skipTrailingSlashRedirect: true,
  // Same-origin proxy: the browser sends the auth cookies to Next, which forwards
  // them to Django, so no CORS preflight and cookies stay first-party.
  async rewrites() {
    return [
      // Paths arrive exactly as the browser sent them; Django's own middleware
      // adds the trailing slash its URL map expects.
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/media/:path*', destination: `${API_ORIGIN}/media/:path*` },
      // The DM socket rides the same first-party proxy: a cross-origin
      // WebSocket handshake would carry no cookies at all.
      { source: '/ws/:path*', destination: `${API_ORIGIN}/ws/:path*` },
    ];
  },
};

module.exports = nextConfig;
