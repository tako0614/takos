import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

export default function BundledApps() {
  const t = useT();
  void reveal;
  return (
    <Section splat id='apps' eyebrow={t.apps.eyebrow} title={t.apps.title} lede={t.apps.lede}>
      <div class='features'>
        <For each={t.apps.items}>
          {(a, i) => (
            <article class='feature reveal' use:reveal={i() * 60}>
              <h4>
                {a.name} <span class='feature-tag'>{a.tag}</span>
              </h4>
              <p>{a.body}</p>
            </article>
          )}
        </For>
      </div>
    </Section>
  );
}
