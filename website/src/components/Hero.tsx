import { For } from 'solid-js';
import SplatField from './SplatField';
import AppVisual from './AppVisual';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';
import { useParallax } from '~/lib/interactions';

export default function Hero() {
  const t = useT();
  const cloud = useCloudUrls();
  let splashRef: HTMLDivElement | undefined;
  useParallax(() => splashRef, 0.16);

  return (
    <section class='hero'>
      <div ref={splashRef} class='hero-splat-wrap' aria-hidden='true'>
        <SplatField density='hero' />
      </div>
      <div class='container hero-grid'>
        <div class='hero-copy'>
          <p class='hero-kicker'>{t.hero.kicker}</p>
          <h1>
            <For each={t.hero.title}>
              {(line) => (
                <span class='hero-line' classList={{ 'hero-accent': line.grad }}>
                  {line.t}
                </span>
              )}
            </For>
          </h1>
          <p class='lede'>
            <RichText value={t.hero.lede} />
          </p>
          <div class='cta-row'>
            <a class='btn btn-primary' href={cloud().useTakos} rel='noopener'>
              {t.hero.useTakos}
            </a>
            <a
              class='btn btn-secondary'
              href='https://github.com/tako0614/takos'
              rel='noopener'
            >
              {t.hero.github}
            </a>
          </div>
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
