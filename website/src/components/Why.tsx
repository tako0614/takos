import { For } from 'solid-js';
import Section from './Section';
import RichText from './RichText';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

export default function Why() {
  const t = useT();
  void reveal;
  return (
    <Section
      id='why'
      title={t.why.title}
      lede={<RichText value={t.why.lede} />}
    >
      <div class='why-points'>
        <For each={t.why.points}>
          {(p, i) => (
            <div class='why-point reveal' use:reveal={i() * 90}>
              <span class='why-num'>{String(i() + 1).padStart(2, '0')}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          )}
        </For>
      </div>
    </Section>
  );
}
