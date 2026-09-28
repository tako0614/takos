import { For, type JSX } from 'solid-js';
import AppVisual from './AppVisual';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** Document head: product name, one factual descriptor line, the spec rows,
 *  then the real app screen. The page opens as a document — no billboard. */
export default function Head(): JSX.Element {
  const t = useT();
  const cloud = useCloudUrls();

  return (
    <section class='doc-head'>
      <div class='container'>
        <h1 class='doc-title'>Takos</h1>
        <p class='doc-tagline'>{t.head.tagline}</p>
        <p class='doc-lede'>
          <RichText value={t.head.lede} />
        </p>
        <p class='intro-links'>
          <a class='link-go' href={cloud().useTakos} rel='noopener'>
            {t.head.useTakos} →
          </a>
          <a class='link-go' href='https://docs.takos.jp/' rel='noopener'>
            {t.head.docs} →
          </a>
          <a class='link-go' href='https://github.com/tako0614/takos' rel='noopener'>
            {t.head.github} →
          </a>
        </p>
        <dl class='spec-list'>
          <For each={t.head.spec}>
            {(r) => (
              <div class='spec-row'>
                <dt>{r.term}</dt>
                <dd>{r.def}</dd>
              </div>
            )}
          </For>
        </dl>
        <AppVisual kind='chat' />
      </div>
    </section>
  );
}

