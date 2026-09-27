import { For, type JSX } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** One request traced through the real surfaces it touches: Chat, the Work
 *  board, then docs + Memory. Screenshot-led: each step shows the actual UI
 *  with a functional caption — the app is the tour. */
export default function Run(): JSX.Element {
  const t = useT();
  return (
    <Section id='features' title={t.run.title} lede={t.run.lede}>
      <ol class='run'>
        <For each={t.run.steps}>
          {(step, i) => (
            <li class='run-step'>
              <div class='run-copy'>
                <h3>
                  <span class='run-num'>{i() + 1}.</span> {step.name}
                </h3>
                <p>{step.connect}</p>
              </div>
              <div class='run-visual'>
                <AppVisual kind={step.key} />
              </div>
            </li>
          )}
        </For>
      </ol>
    </Section>
  );
}
