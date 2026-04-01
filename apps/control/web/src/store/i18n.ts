import { atom } from 'jotai/vanilla';
import { useAtomValue, useSetAtom } from 'solid-jotai';
import { atomWithStorageVanilla } from '../lib/storage-atom.ts';
import { type Language, type TranslationKey, type TranslationParams, getTranslation } from '../i18n.ts';

export type { TranslationKey, TranslationParams };

const STORAGE_KEY = 'takos-lang';

/** Detect the initial language from localStorage or browser settings. */
function detectInitialLanguage(): Language {
  const storage = globalThis.localStorage;
  if (!storage) return 'en';
  const stored = storage.getItem(STORAGE_KEY);
  if (stored === 'ja' || stored === 'en') return stored;
  const browserLang = globalThis.navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

/** Persisted language preference atom. */
export const languageAtom = atomWithStorageVanilla<Language>(STORAGE_KEY, detectInitialLanguage());

/** Derived read-only atom providing the translation function. */
export const translationAtom = atom((get) => {
  const lang = get(languageAtom);

  const t = (key: TranslationKey, params?: TranslationParams): string =>
    getTranslation(lang, key, params);

  const tOr = (key: TranslationKey, fallback: string, params?: TranslationParams): string => {
    const translated = getTranslation(lang, key, params);
    return translated === key ? fallback : translated;
  };

  return { t, tOr };
});

/** Drop-in replacement for the old Context-based useI18n hook. */
export function useI18n() {
  const lang = useAtomValue(languageAtom);
  const setLang = useSetAtom(languageAtom);
  const translation = useAtomValue(translationAtom);

  return {
    get lang() { return lang(); },
    get t() { return translation().t; },
    get tOr() { return translation().tOr; },
    setLang,
  };
}
