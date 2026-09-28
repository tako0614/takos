import { For, type JSX } from 'solid-js';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** The workspace, region by region. Each station is a caption margin plus
 *  the real screen bleeding to the viewport edge — alternating sides so the
 *  page reads as a walk-through, not a feature grid. Names are the UI's own
 *  (chat / Work board / memory), not marketing titles. */
export default function Stations(): JSX.Element {
  const t = useT();
  return (
    <section id='workspace' class='stations' aria-label='Workspace'>
      <For each={t.stations}>
        {(s, i) => (
          <div class={i() % 2 === 0 ? 'station' : 'station station-r'}>
            <div class='st-cap'>
              <span class='st-eyebrow'>{s.eyebrow}</span>
              <h3 class='st-name'>{s.name}</h3>
              <p class='st-body'>{s.body}</p>
            </div>
            <div class='st-shot'>
              <AppVisual kind={s.key} />
            </div>
          </div>
        )}
      </For>
    </section>
  );
}
