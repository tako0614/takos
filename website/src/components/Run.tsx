import { For, type JSX } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** One request traced through the real surfaces it touches: chat thread,
 *  Work board, then docs + memory. Each stage is a heading, one sentence,
 *  and the actual UI it happens on. */
export default function Run(): JSX.Element {
  const t = useT();
  return (
    <Section id='run' title={t.run.title} lede={t.run.lede}>
      <For each={t.run.steps}>
        {(step) => (
          <div class='step'>
            <h3>{step.name}</h3>
            <p>{step.connect}</p>
            <AppVisual kind={step.key} />
          </div>
        )}
      </For>
    </Section>
  );
}
