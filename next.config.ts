import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * The game layer (Phaser) is fully self-hosted: no third-party CDNs, no remote
 * fonts, no analytics. That lets us keep `default-src 'self'` which is a far
 * stronger posture than the typical "unsafe-inline everywhere" policy.
 *
 * `'unsafe-inline'` is required for styles because Next.js injects CSS custom
 * properties + Tailwind v4 emits stylesheets that are inlined in the document.
 * Script execution is NOT relaxed: `script-src` has no `unsafe-inline` and no
 * `unsafe-eval` outside development (where React Refresh needs eval).
 */
const isDev = process.env.NODE_ENV !== 'production';

const cspDirectives = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-eval' 'strict-dynamic'"
    : "script-src 'self' 'strict-dynamic'",
  // Phaser + Next hydration both need style attributes / injected <style>.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspDirectives },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  ...(isDev
    ? []
    : [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emit long-lived, content-hashed assets so the pixel-art pack can be cached hard.
  productionBrowserSourceMaps: false,
  compress: true,
  images: {
    // Everything is either generated at runtime or served from /public.
    remotePatterns: [],
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    // Ship less JS to the browser: only the pages that need it.
    optimizePackageImports: ['phaser'],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // The generated pixel-art pack is immutable; content is versioned by query.
        source: '/assets/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
