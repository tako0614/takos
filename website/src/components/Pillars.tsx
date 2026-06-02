import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

export default function Pillars() {
  const t = useT();
  void reveal;
  return (
    <Section splat id='core' eyebrow={t.pillars.eyebrow} title={t.pillars.title} lede={t.pillars.lede}>
      <div class='pillars'>
        <For each={t.pillars.items}>
          {(p, i) => (
            <article class='pillar reveal' use:reveal={i() * 80}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          )}
        </For>
      </div>
    </Section>
  );
}
