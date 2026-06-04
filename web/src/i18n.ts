import { ja } from "./i18n/ja.ts";
import { en } from "./i18n/en.ts";

export type Language = "ja" | "en";

export const translations = {
  ja,
  en,
} as const;

export type TranslationKey = keyof typeof translations.ja;

export type TranslationParams = Record<string, string | number>;

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function getTranslation(
  lang: Language,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const base = translations[lang][key] || translations.en[key] || key;
  return interpolate(base, params);
}

export { detectLanguage, LANGUAGE_STORAGE_KEY, setLanguage } from "./lib/locale.ts";
