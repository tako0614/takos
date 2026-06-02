import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

export default function Stats() {
  const t = useT();
  void reveal;
  return (
    <Section splat class='stats' eyebrow={t.stats.eyebrow} title={t.stats.title}>
      <div class='stats-grid'>
        <For each={t.stats.items}>
          {(s, i) => (
            <div class='stat reveal' use:reveal={i() * 70}>
              <div class='stat-num'>{s.num}</div>
              <div class='stat-label'>{s.label}</div>
              <p class='stat-note'>{s.note}</p>
            </div>
          )}
        </For>
      </div>
    </Section>
  );
}
