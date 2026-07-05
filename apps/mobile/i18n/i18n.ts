/**
 * Pure translation lookup (SESSION P4-01). No React, no side effects — trivially
 * unit-testable. Resolves a key in the requested language, falls back to English,
 * then to the raw key, and interpolates `{param}` placeholders.
 */

import { translations, type AppLanguage, type TranslationKey } from './translations';

/** Languages written right-to-left. */
export const RTL_LANGUAGES = new Set<AppLanguage>(['ar']);

export function isRTL(lang: AppLanguage): boolean {
  return RTL_LANGUAGES.has(lang);
}

export type TranslateParams = Record<string, string | number>;

/** Translate `key` into `lang`, interpolating `{name}` params. */
export function translate(
  lang: AppLanguage,
  key: TranslationKey,
  params?: TranslateParams,
): string {
  const template = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
