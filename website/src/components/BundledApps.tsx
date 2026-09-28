import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';

/** First-party installable apps as a spec list — hairline rows, not cards. */
export default function BundledApps() {
  const t = useT();
  return (
    <Section id='apps' index='03' title={t.apps.title} lede={t.apps.lede}>
      <ul class='app-list'>
        <For each={t.apps.items}>
          {(a) => (
            <li class='app-row'>
              <div class='app-row-id'>
                <span class='app-name'>{a.name}</span>
                <span class='feature-tag'>{a.tag}</span>
                <span class='app-role'>{a.role}</span>
              </div>
              <p class='app-body'>{a.body}</p>
            </li>
          )}
        </For>
      </ul>
    </Section>
  );
}
