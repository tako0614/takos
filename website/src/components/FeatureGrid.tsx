import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

export default function FeatureGrid() {
  const t = useT();
  void reveal;
  return (
    <Section splat id='features' eyebrow={t.features.eyebrow} title={t.features.title} lede={t.features.lede}>
      <div class='features'>
        <For each={t.features.items}>
          {(f, i) => (
            <article class='feature reveal' use:reveal={i() * 60}>
              <h4>{f.title}</h4>
              <p>{f.body}</p>
            </article>
          )}
        </For>
      </div>
    </Section>
  );
}
