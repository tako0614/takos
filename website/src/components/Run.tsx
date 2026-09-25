import { For, type JSX } from 'solid-js';
import Section from './Section';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

/** One request traced through the real surfaces it touches: Chat, the Work
 *  board, then docs + Memory. The rail and state labels read as transitions
 *  (asked → running → kept), not a feature catalog. */
export default function Run(): JSX.Element {
  const t = useT();
  void reveal;
  return (
    <Section id='features' title={t.run.title} lede={t.run.lede}>
      <p class='run-request reveal' use:reveal>
        <span class='run-request-label'>request</span>
        {t.run.request}
      </p>
      <ol class='run'>
        <For each={t.run.steps}>
          {(step, i) => (
            <li class='run-step reveal' use:reveal={i() * 60}>
              <div class='run-rail' aria-hidden='true'>
                <span class='run-dot' />
              </div>
              <div class='run-copy'>
                <span class='run-state'>{step.state}</span>
                <h3>{step.name}</h3>
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
