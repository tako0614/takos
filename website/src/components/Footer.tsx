import { For } from 'solid-js';
import Bubbles from './Bubbles';
import LangToggle from './LangToggle';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** Deep water — the page sinks to the field's dark floor: the mark tile,
 *  the word, the links, white type on deep blue, dimmer bubbles. */
export default function Footer() {
  const t = useT();
  const cloud = useCloudUrls();

  const hrefFor = (link: { href: string; cloud?: boolean }) => (link.cloud ? cloud().home : link.href);

  return (
    <footer class='site'>
      <Bubbles />
      <div class='container'>
        <div class='footer-brand'>
          <img class='footer-mark' src='/brand/tako.png' alt='' width='578' height='547' decoding='async' />
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
