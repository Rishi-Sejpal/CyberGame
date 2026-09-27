import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Vendored pixel font (SIL OFL). Self-hosted so there is no third-party font
 * request, which keeps the CSP at `default-src 'self'` and means we never leak
 * a visitor's IP to a font vendor.
 */
const pixel = localFont({
  src: [{ path: '../../public/fonts/press-start-2p-latin.woff2', weight: '400', style: 'normal' }],
  variable: '--font-pixel',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'CYBERGRID — a pixel-art cybersecurity academy',
    template: '%s · CYBERGRID',
  },
  description:
    'Explore a living 2D pixel-art world and learn networking, packet analysis, subnetting and network defense by playing. Earn XP, unlock missions, master the grid.',
  applicationName: 'CYBERGRID',
  keywords: [
    'cybersecurity learning',
    'networking game',
    'pixel art game',
    'learn subnetting',
    'packet analysis game',
  ],
  authors: [{ name: 'CYBERGRID' }],
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'CYBERGRID',
    title: 'CYBERGRID — a pixel-art cybersecurity academy',
    description:
      'A 2D adventure where you learn networking by walking the grid: routers, switches, packets, subnets and firewalls.',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#04060d',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixel.variable} suppressHydrationWarning>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-neon focus:px-4 focus:py-2 focus:text-abyss"
        >
          Skip to content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
