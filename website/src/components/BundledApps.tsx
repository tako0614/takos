import { For } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** First-party installable apps — the real install screen, then a plain list
 *  of what exists. */
export default function BundledApps() {
  const t = useT();
  return (
    <Section id='apps' title={t.apps.title} lede={t.apps.lede}>
      <AppVisual kind='install' />
      <ul class='app-list'>
        <For each={t.apps.items}>
          {(a) => (
            <li>
              <span class='app-name'>{a.name}</span>
              <span class='app-body'>{a.body}</span>
            </li>
          )}
        </For>
      </ul>
    </Section>
  );
}
