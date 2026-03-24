import { ja } from './i18n/ja';
import { en } from './i18n/en';

export type Language = 'ja' | 'en';

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

export function getTranslation(lang: Language, key: TranslationKey, params?: TranslationParams): string {
  const base = translations[lang][key] || translations.en[key] || key;
  return interpolate(base, params);
}

export function detectLanguage(): Language {
  const stored = localStorage.getItem('takos-lang');
  if (stored === 'ja' || stored === 'en') {
    return stored;
  }
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

export function setLanguage(lang: Language): void {
  localStorage.setItem('takos-lang', lang);
}
