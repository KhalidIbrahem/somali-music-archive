import type { MetadataRoute } from 'next';

/** Public pages are indexable; member, admin and API routes are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/account', '/dashboard', '/login', '/register', '/teach', '/api/'],
      },
    ],
    sitemap: 'https://qaraamigen.com/sitemap.xml',
    host: 'https://qaraamigen.com',
  };
}
