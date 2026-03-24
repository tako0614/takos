import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { type Language, type TranslationKey, type TranslationParams, getTranslation, detectLanguage, setLanguage as persistLanguage } from '../i18n';

export type { TranslationKey, TranslationParams };

export interface I18nContextType {
  lang: Language;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  tOr: (key: TranslationKey, fallback: string, params?: TranslationParams) => string;
  setLang: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  t: (key) => key,
  tOr: (_key, fallback) => fallback,
  setLang: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(detectLanguage);

  const t = useCallback((key: TranslationKey, params?: TranslationParams) => getTranslation(lang, key, params), [lang]);
  const tOr = useCallback((key: TranslationKey, fallback: string, params?: TranslationParams) => {
    const translated = getTranslation(lang, key, params);
    return translated === key ? fallback : translated;
  }, [lang]);

  const handleSetLang = useCallback((newLang: Language) => {
    setLang(newLang);
    persistLanguage(newLang);
  }, []);

  const value = useMemo(() => ({ lang, t, tOr, setLang: handleSetLang }), [lang, t, tOr, handleSetLang]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
