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
  async redirects() {
    // §226: Alte WEBFLOW-URLs ranken noch bei Google und bekamen Klicks auf
    // unsere 404 (Search-Console-Befund 30.07.: ~9 Klicks + ~190 Impressionen
    // in 28 Tagen). 301 fängt die Besucher auf und überträgt die Rankings.
    return [
      // Wohnungs-Detailseiten (Webflow: /activities-and-places/<slug>)
      { source: '/activities-and-places/panorama-home', destination: '/listing/panorama-home', permanent: true },
      { source: '/activities-and-places/magnolia-flat', destination: '/listing/magnolia-flat', permanent: true },
      { source: '/activities-and-places/cozy-flat', destination: '/listing/cozy-flat', permanent: true },
      { source: '/activities-and-places/city-home', destination: '/listing/city-home', permanent: true },
      { source: '/activities-and-places/sunrisesuite', destination: '/listing/sunrise-suite', permanent: true },
      { source: '/activities-and-places/sweet-spot', destination: '/listing/sweet-spot', permanent: true },
      { source: '/activities-and-places/river-retreat', destination: '/listing/river-retreat', permanent: true },
      { source: '/activities-and-places/:path*', destination: '/', permanent: true },
      // Info-Seiten
      { source: '/gut-zu-wissen/wer-wir-sind', destination: '/ueber-uns', permanent: true },
      { source: '/gut-zu-wissen/gasteinfos', destination: '/faq', permanent: true },
      { source: '/gut-zu-wissen/:path*', destination: '/ueber-uns', permanent: true },
      // Übersichts-/Kategorie-Seiten
      { source: '/apartments', destination: '/', permanent: true },
      { source: '/category/:path*', destination: '/', permanent: true },
      // Rechtstexte (Webflow: /template-info/…)
      { source: '/template-info/impressum', destination: '/impressum', permanent: true },
      { source: '/template-info/datenschutzerklarung', destination: '/datenschutz', permanent: true },
      { source: '/template-info/agb', destination: '/agb', permanent: true },
      { source: '/template-info/:path*', destination: '/impressum', permanent: true },
    ]
  },
  async headers() {
    // Content-Security-Policy — seit 20.07. SCHARF (lief ab 15.07. im
    // Report-Only ohne Verletzungen; Konsole auf /, Listing, Region und /team
    // gegengeprüft). Bei neuen Drittanbietern: Inventar unten ergänzen!
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
      // Sprachnachrichten/Videos im Team-Chat (Supabase Storage) + lokale Previews
      "media-src 'self' blob: https://wccrfgjzxpztfmnqpfiy.supabase.co",
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
          // microphone=(self): Sprachnachrichten + 🎤-Zuhör-Modus der Team-App
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
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
      {
        // Duplicate-Content-Schutz: trimosa-app.vercel.app (+ Previews) spiegelt
        // die komplette Seite — nur trimosa.de soll in den Google-Index.
        source: '/:path*',
        has: [{ type: 'host', value: '(.*)\\.vercel\\.app' }],
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ]
  },
};

export default nextConfig;
