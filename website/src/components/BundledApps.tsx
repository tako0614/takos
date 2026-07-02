import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

export default function BundledApps() {
  const t = useT();
  void reveal;
  return (
    <Section id='apps' title={t.apps.title} lede={t.apps.lede}>
      <div class='app-cards'>
        <For each={t.apps.items}>
          {(a, i) => (
            <article class='app-card reveal' use:reveal={i() * 80}>
              <div class='app-card-head'>
                <h3>{a.name}</h3>
                <span class='feature-tag'>{a.tag}</span>
              </div>
              <div class='app-card-role'>{a.role}</div>
              <p>{a.body}</p>
            </article>
          )}
        </For>
      </div>
    </Section>
  );
}
