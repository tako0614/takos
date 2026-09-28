import { For, type JSX } from 'solid-js';
import AppVisual from './AppVisual';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** Page head — identity in the product's own voice: the icon tile, the
 *  bitmap wordmark, one factual paragraph and a mono fact line. Then the
 *  real app window runs edge to edge, with mono chips pinned to the
 *  regions they name — the product is the pitch, annotated. */
export default function Head(): JSX.Element {
  const t = useT();
  const cloud = useCloudUrls();

  return (
    <section class='page-head'>
      <div class='container'>
        <div class='head-id'>
          <img
            class='head-icon'
            src='/logo.png'
            alt=''
            width='56'
            height='56'
            decoding='async'
          />
          <h1 class='page-title'>Takos</h1>
        </div>
        <p class='page-desc'>
          <RichText value={t.head.desc} />
        </p>
        <p class='page-facts'>{t.head.facts}</p>
        <div class='page-actions'>
          <a class='btn' href={cloud().useTakos} rel='noopener'>
            {t.head.useTakos}
          </a>
          <a href='https://docs.takos.jp/' rel='noopener'>
            {t.head.docs}
          </a>
          <a href='https://github.com/tako0614/takos' rel='noopener'>
            {t.head.github}
          </a>
        </div>
        <div class='head-shot'>
          <div class='hero-frame'>
            <AppVisual kind='chat' hero />
            <ul class='hero-labels' aria-hidden='true'>
              <For each={t.hero.labels}>
                {(l) => (
                  <li
                    class='hero-chip'
                    style={{ left: l.x + '%', top: l.y + '%' }}
                  >
                    {l.t}
                  </li>
                )}
              </For>
            </ul>
          </div>
          <p class='hero-cap'>{t.hero.caption}</p>
        </div>
      </div>
    </section>
  );
}
