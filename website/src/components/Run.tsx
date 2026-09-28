import { For, type JSX } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** One request traced through the real surfaces it touches: chat thread,
 *  Work board, then docs + memory. Steps alternate text/screenshot sides —
 *  the run reads left to right, then folds back, like a path through the
 *  water instead of a stack of cards. */
export default function Run(): JSX.Element {
  const t = useT();
  return (
    <Section id='run' title={t.run.title} lede={t.run.lede}>
      <For each={t.run.steps}>
        {(step, i) => (
          <div class='step'>
            <div class='step-copy'>
              <span class='step-index'>{String(i() + 1).padStart(2, '0')}</span>
              <h3>{step.name}</h3>
              <p>{step.connect}</p>
            </div>
            <AppVisual kind={step.key} />
          </div>
        )}
      </For>
    </Section>
  );
}
