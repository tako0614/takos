import { atom, useAtomValue, useSetAtom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import { useMemo } from 'react';
import { type Language, type TranslationKey, type TranslationParams, getTranslation } from '../i18n';

export type { TranslationKey, TranslationParams };

const STORAGE_KEY = 'takos-lang';

/** Detect the initial language from localStorage or browser settings. */
function detectInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'ja' || stored === 'en') return stored;
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

/** Persisted language preference atom. */
export const languageAtom = atomWithStorage<Language>(
  STORAGE_KEY,
  detectInitialLanguage(),
  createJSONStorage(() => localStorage),
  { getOnInit: true },
);

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
  const { t, tOr } = useAtomValue(translationAtom);

  return useMemo(
    () => ({ lang, t, tOr, setLang }),
    [lang, t, tOr, setLang],
  );
}
