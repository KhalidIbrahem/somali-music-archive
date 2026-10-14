import type { MetadataRoute } from 'next';

const SITE = 'https://qaraamigen.com';

/** The public pages, most important first. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (
    path: string,
    priority: number,
    changeFrequency: 'weekly' | 'monthly',
  ): MetadataRoute.Sitemap[number] => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });
  return [
    page('/', 1.0, 'weekly'),
    page('/generate', 0.9, 'weekly'),
    page('/transcribe', 0.9, 'weekly'),
    page('/listen', 0.9, 'weekly'),
    page('/studio', 0.9, 'weekly'),
    page('/gallery', 0.8, 'weekly'),
    page('/library', 0.7, 'monthly'),
    page('/scores/beerdilaacshe', 0.7, 'monthly'),
    page('/studio/score', 0.5, 'monthly'),
  ];
}
