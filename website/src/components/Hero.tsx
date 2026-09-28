import { For } from 'solid-js';
import AppVisual from './AppVisual';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';

/** Workbench hero: a compact factual header, then the real product screen
 *  full-width — the app itself is the visual, not decoration. */
export default function Hero() {
  const t = useT();
  const cloud = useCloudUrls();

  return (
    <section class='hero'>
      <div class='container'>
        <div class='hero-copy'>
          <h1>
            <For each={t.hero.title}>
            {(line) => (
                <span class='hero-line'>
                  {line.t}
                </span>
              )}
            </For>
          </h1>
          <p class='lede'>
            <RichText value={t.hero.lede} />
          </p>
          <p class='intro-links'>
            <a class='link-go' href={cloud().useTakos} rel='noopener'>
              {t.hero.useTakos} →
            </a>
            <a
              class='link-go'
              href='https://github.com/tako0614/takos'
              rel='noopener'
            >
              {t.hero.github} →
            </a>
            <a class='link-go' href='https://docs.takos.jp/' rel='noopener'>
              Docs →
            </a>
          </p>
          <p class='hero-clone'>
            {t.hero.cloneHint}{' '}
            <code>git clone https://github.com/tako0614/takos.git</code>
          </p>
          <ul class='hero-spec' aria-label='contents'>
            <For each={t.hero.spec}>{(s) => <li>{s}</li>}</For>
          </ul>
        </div>
        <div class='hero-visual'>
          <AppVisual kind='chat' />
        </div>
      </div>
    </section>
  );
}
