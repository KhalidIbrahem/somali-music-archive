/**
 * Languages — split into two distinct concerns that must not be conflated:
 *
 *   CONTENT_LANGUAGES — the language *spoken/sung in a recording* (`recording.language`).
 *                       Wider set, because field recordings contain code-switching.
 *   UI_LANGUAGES      — languages the *app interface* is translated into.
 *                       Narrower set, driven by product/localization capacity.
 *
 * WHY BCP-47 / ISO-639-1 codes ('so', 'ar', 'en', 'sw'): they are the universal
 * standard understood by every OS, browser, and dataset consumer. Somali ('so')
 * is always the default and primary language of this platform.
 */

// ── Content languages (what is in the audio) ─────────────────────────────────
export const CONTENT_LANGUAGES = ['so', 'ar', 'sw', 'other'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

// ── UI languages (what the app is translated into) ───────────────────────────
export const UI_LANGUAGES = ['so', 'ar', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** The platform default. Somali comes first, always (ARCHITECTURE.md Principle 1). */
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'so';

export interface LanguageDescriptor {
  /** BCP-47 / ISO-639-1 code. */
  readonly code: string;
  /** English name. */
  readonly englishName: string;
  /** Endonym (name in the language itself). */
  readonly nativeName: string;
  /** Text direction — Arabic is right-to-left. */
  readonly direction: 'ltr' | 'rtl';
}

export const LANGUAGE_DESCRIPTORS: Readonly<Record<string, LanguageDescriptor>> = {
  so: { code: 'so', englishName: 'Somali', nativeName: 'Soomaali', direction: 'ltr' },
  ar: { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  en: { code: 'en', englishName: 'English', nativeName: 'English', direction: 'ltr' },
  sw: { code: 'sw', englishName: 'Swahili', nativeName: 'Kiswahili', direction: 'ltr' },
  other: { code: 'other', englishName: 'Other', nativeName: 'Other', direction: 'ltr' },
};

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && (UI_LANGUAGES as readonly string[]).includes(value);
}

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(value);
}
