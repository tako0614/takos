import { For, type JSX } from 'solid-js';
import Section from './Section';
import RichText from './RichText';
import { useT } from '~/lib/i18n';

/** Where the data lives — stated as fact rows, not a pitch and not an
 *  us-vs-them table. */
export default function Data(): JSX.Element {
  const t = useT();
  return (
    <Section id='data' index='04' title={t.data.title} lede={<RichText value={t.data.lede} />}>
      <dl class='def-list'>
        <For each={t.data.rows}>
          {(r) => (
            <div class='def-row'>
              <dt>{r.term}</dt>
              <dd>{r.def}</dd>
            </div>
          )}
        </For>
      </dl>
    </Section>
  );
}

