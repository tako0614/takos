import { For, type JSX } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** One request traced through the real surfaces it touches: chat thread,
 *  Work board, then docs + memory. Each step pairs a compact note with the
 *  actual UI crop it happens on. */
export default function Run(): JSX.Element {
  const t = useT();
  return (
    <Section id='run' index='01' title={t.run.title} lede={t.run.lede}>
      <ol class='run-steps'>
        <For each={t.run.steps}>
          {(step, i) => (
            <li class='run-step'>
              <div class='run-step-copy'>
                <h3>
                  <span class='run-num'>{String(i() + 1).padStart(2, '0')}</span>
                  {step.name}
                </h3>
                <p class='run-connect'>{step.connect}</p>
              </div>
              <AppVisual kind={step.key} />
            </li>
          )}
        </For>
      </ol>
    </Section>
  );
}

