import { For } from 'solid-js';
import Wordmark from './brand/Wordmark';
import LangToggle from './LangToggle';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

export default function Footer() {
  const t = useT();
  const cloud = useCloudUrls();

  const hrefFor = (link: { href: string; cloud?: boolean }) => (link.cloud ? cloud().home : link.href);

  return (
    <footer class='site'>
      <div class='container'>
        <div class='footer-brand'>
          <Wordmark variant='inkdrop' size={22} />
          <p class='footer-tagline'>{t.footer.tagline}</p>
          <span class='copy'>{t.footer.copyright}</span>
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
