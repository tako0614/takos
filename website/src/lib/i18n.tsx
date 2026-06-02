import { createContext, type JSX, useContext } from 'solid-js';
import { type Locale, SITE, type Strings } from '~/content/site';

const LocaleContext = createContext<Locale>('ja');

/**
 * Provides the active locale to the tree. The locale is fixed per prerendered
 * route (`/` → ja, `/en/` → en), so no reactivity is needed — this stays
 * fully static-render friendly.
 */
export function LocaleProvider(props: { locale: Locale; children: JSX.Element }): JSX.Element {
  return <LocaleContext.Provider value={props.locale}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The active locale's full string set. */
export function useT(): Strings {
  return SITE[useLocale()];
}

export function otherLocale(l: Locale): Locale {
  return l === 'ja' ? 'en' : 'ja';
}

/** URL path that renders the given locale. */
export function localePath(l: Locale): string {
  return l === 'ja' ? '/' : '/en/';
}

export const LOCALE_LABEL: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
};

/** Absolute canonical URL for a locale (used for hreflang / og:url). */
export function localeUrl(l: Locale): string {
  return l === 'ja' ? 'https://takos.jp/' : 'https://takos.jp/en/';
}
