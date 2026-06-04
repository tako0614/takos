import { createPersistedSignal } from "../lib/storage-atom.ts";
import {
  getTranslation,
  type Language,
  type TranslationKey,
  type TranslationParams,
} from "../i18n.ts";
import { detectLanguage, LANGUAGE_STORAGE_KEY } from "../lib/locale.ts";

export type { TranslationKey, TranslationParams };

const [language, setLanguage] = createPersistedSignal<Language>(
  LANGUAGE_STORAGE_KEY,
  detectLanguage(),
);

const translate = (
  key: TranslationKey,
  params?: TranslationParams,
): string => getTranslation(language(), key, params);

const translateOr = (
  key: TranslationKey,
  fallback: string,
  params?: TranslationParams,
): string => {
  const translated = getTranslation(language(), key, params);
  return translated === key ? fallback : translated;
};

export function useI18n() {
  return {
    get lang() {
      return language();
    },
    t: translate,
    tOr: translateOr,
    setLang: setLanguage,
  };
}
