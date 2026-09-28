import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';

/** First-party installable apps — white tiles on the water. */
export default function BundledApps() {
  const t = useT();
  return (
    <Section id='apps' title={t.apps.title} lede={t.apps.lede}>
      <ul class='app-list'>
        <For each={t.apps.items}>
          {(a) => (
            <li class='px-panel px-shadow-sm'>
              <span class='app-name'>{a.name}</span>
              <span class='app-body'>{a.body}</span>
            </li>
          )}
        </For>
      </ul>
    </Section>
  );
}
