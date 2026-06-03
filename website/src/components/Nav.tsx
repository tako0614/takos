import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import Wordmark from './brand/Wordmark';
import LangToggle from './LangToggle';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

export default function Nav() {
  const t = useT();
  const cloud = useCloudUrls();
  const [scrolled, setScrolled] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  let burgerRef: HTMLButtonElement | undefined;

  const closeMenu = () => {
    setMenuOpen(false);
    burgerRef?.focus();
  };

  onMount(() => {
    const onScroll = () => {
      setScrolled(globalThis.scrollY > globalThis.innerHeight * 0.7);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen()) closeMenu();
    };
    onScroll();
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    globalThis.addEventListener('keydown', onKey);
    onCleanup(() => {
      globalThis.removeEventListener('scroll', onScroll);
      globalThis.removeEventListener('keydown', onKey);
    });
  });

  const links = () => [
    { href: '#why', label: t.nav.why },
    { href: '#features', label: t.nav.features },
    { href: '#apps', label: t.nav.apps },
    { href: 'https://docs.takos.jp/', label: t.nav.docs, external: true },
  ];

  return (
    <header class='nav' classList={{ 'is-scrolled': scrolled(), 'is-menu-open': menuOpen() }}>
      <div class='nav-inner container'>
        <Wordmark variant='inkdrop' />
        <nav class='nav-links' aria-label='Primary'>
          <For each={links()}>
            {(l) => <a href={l.href} rel={l.external ? 'noopener' : undefined}>{l.label}</a>}
          </For>
        </nav>
        <div class='nav-actions'>
          <a class='nav-icon nav-icon-desk' href='https://github.com/tako0614/takos' rel='noopener' aria-label='GitHub'>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <path d='M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.07.78 2.15v3.18c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z' />
            </svg>
          </a>
          <LangToggle class='nav-icon-desk' />
          <a class='btn btn-primary nav-cta' href={cloud().install} rel='noopener'>
            {t.hero.useTakos}
          </a>
          <button
            type='button'
            class='nav-icon nav-burger'
            ref={burgerRef}
            aria-label={menuOpen() ? t.nav.closeMenu : t.nav.openMenu}
            aria-expanded={menuOpen()}
            aria-controls='nav-mobile-panel'
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Show
              when={menuOpen()}
              fallback={
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' aria-hidden='true'>
                  <path d='M3 6h18M3 12h18M3 18h18' />
                </svg>
              }
            >
              <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' aria-hidden='true'>
                <path d='M6 6l12 12M18 6L6 18' />
              </svg>
            </Show>
          </button>
        </div>
      </div>

      <Show when={menuOpen()}>
        <div class='nav-mobile-panel' id='nav-mobile-panel'>
          <nav class='nav-mobile-links' aria-label='Mobile'>
            <For each={links()}>
              {(l) => (
                <a href={l.href} rel={l.external ? 'noopener' : undefined} onClick={() => setMenuOpen(false)}>
                  {l.label}
                </a>
              )}
            </For>
            <div class='nav-mobile-row'>
              <LangToggle />
              <a class='nav-icon' href='https://github.com/tako0614/takos' rel='noopener' aria-label='GitHub'>
                <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                  <path d='M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.07.78 2.15v3.18c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z' />
                </svg>
              </a>
            </div>
          </nav>
        </div>
      </Show>
    </header>
  );
}
