import { For } from 'solid-js';
import Section from './Section';
import { useT } from '~/lib/i18n';

export default function Comparison() {
  const t = useT();
  return (
    <Section id='compare' title={t.compare.title} lede={t.compare.lede}>
      <div class='comparison'>
        <table>
          <thead>
            <tr>
              <th scope='col'></th>
              <th scope='col'>{t.compare.colUs}</th>
              <th scope='col'>{t.compare.colThem}</th>
            </tr>
          </thead>
          <tbody>
            <For each={t.compare.rows}>
              {(r) => (
                <tr>
                  <th scope='row'>{r.label}</th>
                  <td class='us'>{r.us}</td>
                  <td>{r.them}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Section>
  );
}
