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
    // Content-Security-Policy — deliberately REPORT-ONLY first: violations show
    // up in the browser console ("[Report Only]") without breaking anything.
    // Once a few days pass without unexpected reports, rename the header to
    // 'Content-Security-Policy' to enforce it.
    //
    // Origin inventory (keep in sync when adding third parties):
    //  - unpkg.com                 → Leaflet JS + CSS + marker images
    //  - *.basemaps.cartocdn.com   → map tiles (light + voyager)
    //  - <supabase>.supabase.co    → REST/Auth/Storage (fetch) + storage images
    //  - www.google.com/maps       → legacy map iframe fallback (no-coords listings)
    //  - komoot.com / komoot.de    → two-click tour embeds
    //  - img-src https:            → external review avatars (Airbnb/Google/Booking
    //                                CDNs rotate domains, so https: stays broad)
    //  - 'unsafe-inline' script    → Next.js hydration + JSON-LD (nonce migration
    //                                would need middleware; acceptable trade-off)
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://wccrfgjzxpztfmnqpfiy.supabase.co https://*.basemaps.cartocdn.com",
      "frame-src https://www.google.com https://www.komoot.com https://www.komoot.de",
      "worker-src 'self'",
      "manifest-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
    ].join('; ')
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
      {
        // API-Antworten NIE cachen — iOS-PWAs beantworten GETs sonst aus dem
        // HTTP-Cache mit stale/leeren Bodies (Safari: "string did not match
        // the expected pattern"). Gilt bewusst für ALLE Routen inkl. Fehler.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ]
  },
};

export default nextConfig;
