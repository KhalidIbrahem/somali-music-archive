/**
 * useTranslation — the app's binding from the stored language preference to the
 * pure translator (SESSION P4-01).
 *
 * The active UI language is the signed-in user's `language` (authStore), which the
 * profile screen already lets them change; before login it defaults to English.
 * Returns a memoised `t()` plus the language and its text direction.
 */

import { useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { isRTL, translate, type TranslateParams } from './i18n';
import type { AppLanguage, TranslationKey } from './translations';

export function useTranslation(): {
  t: (key: TranslationKey, params?: TranslateParams) => string;
  language: AppLanguage;
  isRTL: boolean;
} {
  const language = (useAuthStore((s) => s.user?.language) ?? 'en') as AppLanguage;
  const t = useCallback(
    (key: TranslationKey, params?: TranslateParams) => translate(language, key, params),
    [language],
  );
  return { t, language, isRTL: isRTL(language) };
}

/** Just the text direction of the active language — a light hook for primitives
 * (e.g. the Text component) that don't need the translator. */
export function useIsRTL(): boolean {
  const language = (useAuthStore((s) => s.user?.language) ?? 'en') as AppLanguage;
  return isRTL(language);
}
