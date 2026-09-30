import { For } from 'solid-js';
import LangToggle from './LangToggle';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** One hairline, the icon tile, the links — the page ends the way the
 *  app's own chrome would. */
export default function Footer() {
  const t = useT();
  const cloud = useCloudUrls();

  const hrefFor = (link: { href: string; cloud?: boolean }) => (link.cloud ? cloud().home : link.href);

  return (
    <footer class='site'>
      <div class='container'>
        <div class='footer-brand'>
          <img class='footer-mark' src='/logo.png' alt='' width='36' height='36' decoding='async' />
          <div class='footer-brand-text'>
            <a href='/' class='footer-word'>Takos</a>
            <span class='copy'>{t.footer.copyright}</span>
          </div>
        </div>
        <div class='footer-meta'>
          <nav aria-label='Footer'>
            <For each={t.footer.links}>
              {(l) => <a href={hrefFor(l)} rel={l.external ? 'external' : 'noopener'}>{l.label}</a>}
            </For>
          </nav>
          <LangToggle />
        </div>
      </div>
    </footer>
  );
}
