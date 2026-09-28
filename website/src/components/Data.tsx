import { For, type JSX } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';

/** Where the data lives — a plain list of facts. */
export default function Data(): JSX.Element {
  const t = useT();
  return (
    <Section id='data' title={t.data.title}>
      <ul class='fact-list'>
        <For each={t.data.points}>{(p) => <li>{p}</li>}</For>
      </ul>
    </Section>
  );
}
