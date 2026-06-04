import type { Language } from "../i18n.ts";

/**
 * Single source of truth for the persisted UI-language key and the
 * detect-language logic. Previously this `localStorage` key and the
 * "stored value or browser fallback" detection were reimplemented in
 * `i18n.ts`, `store/i18n.ts`, `lib/rpc.ts`, `lib/format.ts`, and
 * `store/auth.ts`; route those through here instead.
 */
export const LANGUAGE_STORAGE_KEY = "takos-lang";

/**
 * Resolve the active UI language: a stored `takos-lang` value when present,
 * otherwise the browser language (`ja*` => "ja", everything else => "en").
 *
 * `localStorage` access is wrapped in try/catch because it may be unavailable
 * in tests or privacy-restricted contexts; navigator access is optional-chained
 * for the same reason. Defaults to "en".
 */
export function detectLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "ja" || stored === "en") return stored;
  } catch {
    // localStorage may be unavailable in tests or privacy-restricted contexts.
  }
  const browserLang = globalThis.navigator?.language?.toLowerCase();
  return browserLang?.startsWith("ja") ? "ja" : "en";
}

/**
 * Persist the active UI language under {@link LANGUAGE_STORAGE_KEY}.
 */
export function setLanguage(lang: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  ja: "ja-JP",
  en: "en-US",
};

/**
 * Resolve the active BCP 47 locale tag derived from {@link detectLanguage}
 * ("ja" => "ja-JP", "en" => "en-US"). Used for `Intl` / `toLocaleString`
 * formatting.
 */
export function currentLocale(): string {
  return LOCALE_BY_LANGUAGE[detectLanguage()];
}
