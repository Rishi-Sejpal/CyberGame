import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_URL ?? 'https://cybergrid.app';

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard/',
        '/game/',
        '/missions/',
        '/progress/',
        '/achievements/',
        '/inventory/',
        '/modules/',
        '/profile/',
        '/settings/',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
