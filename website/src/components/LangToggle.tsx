import type { JSX } from 'solid-js';
import { LOCALE_LABEL, localePath, otherLocale, useLocale } from '~/lib/i18n';

/**
 * Switches between the prerendered `/` (ja) and `/en/` (en) routes. A plain
 * link — no client redirect — so it stays SEO-clean and static-friendly.
 */
export default function LangToggle(props: { class?: string }): JSX.Element {
  const target = otherLocale(useLocale());
  return (
    <a
      class={`lang-toggle nav-icon ${props.class ?? ''}`}
      href={localePath(target)}
      rel='alternate'
      hreflang={target}
      aria-label={`Switch to ${LOCALE_LABEL[target]}`}
      title={LOCALE_LABEL[target]}
    >
      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>
        <circle cx='12' cy='12' r='9' />
        <path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' />
      </svg>
      <span class='lang-toggle-text'>{target.toUpperCase()}</span>
    </a>
  );
}
