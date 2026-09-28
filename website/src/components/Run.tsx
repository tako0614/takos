import { For, type JSX } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** One request followed through the surfaces it actually touches, read
 *  top to bottom like a thread: stage index, the surface's real name,
 *  one sentence, then the real screen. */
export default function Run(): JSX.Element {
  const t = useT();
  return (
    <Section id='run' title={t.run.title} lede={t.run.lede}>
      <For each={t.run.steps}>
        {(step, i) => (
          <div class='step'>
            <span class='step-index'>{String(i() + 1).padStart(2, '0')}</span>
            <h3>{step.name}</h3>
            <p>{step.connect}</p>
            <AppVisual kind={step.key} />
          </div>
        )}
      </For>
    </Section>
  );
}
