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
    const stored = parseStoredLanguage(
      globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY),
    );
    if (stored) return stored;
  } catch {
    // localStorage may be unavailable in tests or privacy-restricted contexts.
  }
  const browserLang = globalThis.navigator?.language?.toLowerCase();
  return browserLang?.startsWith("ja") ? "ja" : "en";
}

/**
 * The language picker persists through `createPersistedSignal`, which stores
 * JSON (`"\"en\""`); older builds stored the bare value (`"en"`). Accept both
 * so non-reactive readers (RPC fallback errors, pre-hydration `<html lang>`)
 * honour the user's explicit choice instead of the browser language.
 */
export function parseStoredLanguage(
  stored: string | null | undefined,
): Language | null {
  if (stored === "ja" || stored === "en") return stored;
  if (typeof stored !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return parsed === "ja" || parsed === "en" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the active UI language under {@link LANGUAGE_STORAGE_KEY}, in the
 * same JSON encoding the persisted language signal uses.
 */
export function setLanguage(lang: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(lang));
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
