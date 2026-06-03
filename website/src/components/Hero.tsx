import { For } from 'solid-js';
import SplatField from './SplatField';
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
    <section class='hero hero-simple'>
      <div ref={splashRef} class='hero-splat-wrap' aria-hidden='true'>
        <SplatField density='hero' />
      </div>
      <div class='container hero-center'>
        <span class='eyebrow'>{t.hero.eyebrow}</span>
        <h1>
          <For each={t.hero.title}>
            {(line) => <span class='hero-line' classList={{ 'grad-text': line.grad }}>{line.t}</span>}
          </For>
        </h1>
        <p class='lede'>
          <RichText value={t.hero.lede} />
        </p>
        <div class='cta-row'>
          <a class='btn btn-primary' href={cloud().install} rel='noopener'>
            {t.hero.useTakos}
          </a>
        </div>
      </div>
    </section>
  );
}
