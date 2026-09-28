import type { JSX } from 'solid-js';
import AppVisual from './AppVisual';
import Bubbles from './Bubbles';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** Page head: the mark swims in its own field — the tako tile melts into
 *  the same #00a0e4 the logo is drawn on, the name sets in the bitmap
 *  face, the factual paragraph sits on a paper panel. Then the real app
 *  window, cast like a sprite to the viewport edge. */
export default function Head(): JSX.Element {
  const t = useT();
  const cloud = useCloudUrls();

  return (
    <section class='page-head'>
      <Bubbles />
      <div class='container head-grid'>
        <div>
          <h1 class='page-title'>Takos</h1>
          <p class='page-desc px-panel px-shadow'>
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
        </div>
        <img
          class='head-mark'
          src='/brand/tako.png'
          alt=''
          width='578'
          height='547'
          decoding='async'
        />
      </div>
      <div class='head-shot'>
        <AppVisual kind='chat' hero />
      </div>
    </section>
  );
}
