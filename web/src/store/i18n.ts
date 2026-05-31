import { createPersistedSignal } from "../lib/storage-atom.ts";
import {
  getTranslation,
  type Language,
  type TranslationKey,
  type TranslationParams,
} from "../i18n.ts";

export type { TranslationKey, TranslationParams };

const STORAGE_KEY = "takos-lang";

function detectInitialLanguage(): Language {
  const storage = globalThis.localStorage;
  if (!storage) return "en";
  const stored = storage.getItem(STORAGE_KEY);
  if (stored === "ja" || stored === "en") return stored;
  const browserLang = globalThis.navigator.language.toLowerCase();
  return browserLang.startsWith("ja") ? "ja" : "en";
}

const [language, setLanguage] = createPersistedSignal<Language>(
  STORAGE_KEY,
  detectInitialLanguage(),
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
