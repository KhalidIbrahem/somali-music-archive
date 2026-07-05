/**
 * UI string catalogue (SESSION P4-01, ARCHITECTURE.md §7 multi-language UI).
 *
 * English is the complete base; Somali (`so`) and Arabic (`ar`) provide the same
 * keys and fall back to English for anything not yet translated (see i18n.ts). The
 * active language comes from the user's stored `language` preference, so the
 * existing profile picker drives the whole UI.
 *
 * NOTE: the Somali and Arabic strings are an initial pass and should be reviewed by
 * a native speaker before release (tracked like the paper's empirical placeholders).
 */

import type { UiLanguage } from '@sma/constants';

/** The languages the interface itself is translated into (mirrors UI_LANGUAGES). */
export type AppLanguage = UiLanguage;

/** English base — the source of truth for the set of translatable keys. */
export const en = {
  'tabs.discover': 'Discover',
  'tabs.learn': 'Learn',
  'tabs.search': 'Search',
  'tabs.record': 'Record',
  'tabs.profile': 'Profile',

  'profile.title': 'Profile',
  'profile.guest': 'Guest',
  'profile.saved': 'Saved',
  'profile.lessonsDone': 'Lessons done',
  'profile.section.language': 'Language',
  'profile.section.playbackQuality': 'Playback quality',
  'profile.playback.high': 'High',
  'profile.playback.standard': 'Standard',
  'profile.offlineDownloads': 'Offline downloads',
  'profile.notifications': 'Notifications',
  'profile.sendTestNotification': 'Send test notification',
  'profile.testNotificationSent': 'Test notification sent',
  'profile.clearDownloads': 'Clear downloads ({size})',
  'profile.signOut': 'Sign out',

  'common.loading': 'Loading…',
  'common.retry': 'Try again',
} as const;

/** Every translatable string key. */
export type TranslationKey = keyof typeof en;

/** Somali (Af-Soomaali). Partial — missing keys fall back to English. */
export const so: Partial<Record<TranslationKey, string>> = {
  'tabs.discover': 'Sahan',
  'tabs.learn': 'Baro',
  'tabs.search': 'Raadi',
  'tabs.record': 'Duub',
  'tabs.profile': 'Akoonka',

  'profile.title': 'Akoonkayga',
  'profile.guest': 'Marti',
  'profile.saved': 'La keydiyay',
  'profile.lessonsDone': 'Casharro',
  'profile.section.language': 'Luqadda',
  'profile.section.playbackQuality': 'Tayada codka',
  'profile.playback.high': 'Sare',
  'profile.playback.standard': 'Caadi',
  'profile.offlineDownloads': 'Soo-dejin offline',
  'profile.notifications': 'Ogeysiisyada',
  'profile.sendTestNotification': 'Dir ogeysiis tijaabo ah',
  'profile.testNotificationSent': 'Ogeysiiskii waa la diray',
  'profile.clearDownloads': 'Tirtir wixii la soo dejiyay ({size})',
  'profile.signOut': 'Ka bax',

  'common.loading': 'Sugaya…',
  'common.retry': 'Isku day mar kale',
};

/** Arabic (right-to-left). Partial — missing keys fall back to English. */
export const ar: Partial<Record<TranslationKey, string>> = {
  'tabs.discover': 'اكتشف',
  'tabs.learn': 'تعلّم',
  'tabs.search': 'ابحث',
  'tabs.record': 'سجّل',
  'tabs.profile': 'الملف',

  'profile.title': 'الملف الشخصي',
  'profile.guest': 'ضيف',
  'profile.saved': 'المحفوظة',
  'profile.lessonsDone': 'الدروس',
  'profile.section.language': 'اللغة',
  'profile.section.playbackQuality': 'جودة الصوت',
  'profile.playback.high': 'عالية',
  'profile.playback.standard': 'قياسية',
  'profile.offlineDownloads': 'التنزيلات دون اتصال',
  'profile.notifications': 'الإشعارات',
  'profile.sendTestNotification': 'إرسال إشعار تجريبي',
  'profile.testNotificationSent': 'تم إرسال الإشعار التجريبي',
  'profile.clearDownloads': 'مسح التنزيلات ({size})',
  'profile.signOut': 'تسجيل الخروج',

  'common.loading': 'جارٍ التحميل…',
  'common.retry': 'أعد المحاولة',
};

export const translations: Record<AppLanguage, Partial<Record<TranslationKey, string>>> = {
  en,
  so,
  ar,
};
