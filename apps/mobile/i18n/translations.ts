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
  'common.all': 'All',

  'discover.featuredArtists': 'Featured artists',
  'discover.recentRecordings': 'Recent recordings',
  'discover.loading': 'Loading the archive…',
  'discover.loadError': 'Could not load recordings. Pull to retry.',
  'discover.emptyTitle': 'The archive is just beginning',
  'discover.emptyBody': 'Recordings will appear here as they are added and reviewed.',

  'learn.loadingModules': 'Loading modules…',
  'learn.loadError': 'Could not load lessons. Pull to retry.',
  'learn.continue': 'Continue',
  'learn.track.beginner': 'Beginner',
  'learn.track.intermediate': 'Intermediate',
  'learn.track.advanced': 'Advanced',

  'search.label': 'Find a song, artist, or genre',
  'search.placeholder': 'e.g. Balwo, Ahmed, dhaanto…',
  'search.hint': 'Search the archive by song, artist, genre, or era.',
  'search.searching': 'Searching…',
  'search.failed': 'Search failed. Please try again.',
  'search.noResults': 'No recordings match “{query}”.',
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
  'common.all': 'Dhammaan',

  'discover.featuredArtists': 'Fannaaniinta la soo bandhigay',
  'discover.recentRecordings': 'Duubabka dhawaan',
  'discover.loading': 'Waa la soo dejinayaa keydka…',
  'discover.loadError': 'Lama soo dejin karin duubabka. Hoos u jiid.',
  'discover.emptyTitle': 'Keydku wuu bilaabmayaa',
  'discover.emptyBody': 'Duubabku halkan ayay ka soo muuqan doonaan marka la daro oo la eego.',

  'learn.loadingModules': 'Waa la soo dejinayaa cutubyada…',
  'learn.loadError': 'Lama soo dejin karin casharrada. Hoos u jiid.',
  'learn.continue': 'Sii wad',
  'learn.track.beginner': 'Bilow',
  'learn.track.intermediate': 'Dhexe',
  'learn.track.advanced': 'Sare',

  'search.label': 'Raadi hees, fannaan, ama nooc',
  'search.placeholder': 'tusaale: Balwo, Axmed, dhaanto…',
  'search.hint': 'Ka raadi keydka hees, fannaan, nooc, ama xilli.',
  'search.searching': 'Waa la raadinayaa…',
  'search.failed': 'Raadintu way fashilantay. Fadlan isku day mar kale.',
  'search.noResults': 'Ma jiro duub u dhigma “{query}”.',
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
  'common.all': 'الكل',

  'discover.featuredArtists': 'فنانون مميزون',
  'discover.recentRecordings': 'تسجيلات حديثة',
  'discover.loading': 'جارٍ تحميل الأرشيف…',
  'discover.loadError': 'تعذّر تحميل التسجيلات. اسحب لإعادة المحاولة.',
  'discover.emptyTitle': 'الأرشيف في بدايته',
  'discover.emptyBody': 'ستظهر التسجيلات هنا عند إضافتها ومراجعتها.',

  'learn.loadingModules': 'جارٍ تحميل الوحدات…',
  'learn.loadError': 'تعذّر تحميل الدروس. اسحب لإعادة المحاولة.',
  'learn.continue': 'متابعة',
  'learn.track.beginner': 'مبتدئ',
  'learn.track.intermediate': 'متوسط',
  'learn.track.advanced': 'متقدّم',

  'search.label': 'ابحث عن أغنية أو فنان أو نوع',
  'search.placeholder': 'مثال: بلوو، أحمد، دهانتو…',
  'search.hint': 'ابحث في الأرشيف حسب الأغنية أو الفنان أو النوع أو الحقبة.',
  'search.searching': 'جارٍ البحث…',
  'search.failed': 'فشل البحث. حاول مرة أخرى.',
  'search.noResults': 'لا توجد تسجيلات تطابق “{query}”.',
};

export const translations: Record<AppLanguage, Partial<Record<TranslationKey, string>>> = {
  en,
  so,
  ar,
};
