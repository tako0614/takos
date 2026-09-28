import type { JSX } from 'solid-js';
import AppVisual from './AppVisual';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** Page head: product name, one factual paragraph, a plain fact line, the
 *  primary links — then the real app window, bleeding to the viewport edge. */
export default function Head(): JSX.Element {
  const t = useT();
  const cloud = useCloudUrls();

  return (
    <section class='page-head'>
      <div class='container'>
        <div class='head-brand'>
          <img
            class='head-mark'
            src='/brand/tako.png'
            alt=''
            width='920'
            height='740'
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
      </div>
      <div class='head-shot'>
        <AppVisual kind='chat' hero />
      </div>
    </section>
  );
}
