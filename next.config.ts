import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'wccrfgjzxpztfmnqpfiy.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Curated destination photos (lib/regions.ts) — proxied through the
        // image optimizer, so visitors never contact Wikimedia directly.
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        pathname: '/wikipedia/commons/**',
      },
    ],
  },
  async headers() {
    // A full Content-Security-Policy is deliberately left out here — the app
    // loads a Leaflet map (basemaps.cartocdn.com), a Google Maps iframe, and
    // the optional Revyoos review widget, and getting a strict CSP right for
    // all three without being able to test locally risks silently breaking
    // one of them. These headers are the safe subset that don't depend on
    // knowing every external origin the app talks to.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default nextConfig;
