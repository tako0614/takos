import { For, type JSX } from 'solid-js';
import Section from './Section';
import RichText from './RichText';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';
import type { ShowcaseItem } from '~/content/site';

/** Abstract, on-brand visual per core. These are representations (not real
 *  screenshots): bars + short labels evoke the thread / run / memory / space. */
function Visual(props: { kind: ShowcaseItem['key'] }): JSX.Element {
  switch (props.kind) {
    case 'chat':
      return (
        <div class='viz viz-chat' aria-hidden='true'>
          <div class='viz-bar'>
            <span class='viz-chip'>model ▾</span>
            <span class='viz-dots'>● ● ●</span>
          </div>
          <div class='chat-msg chat-user'>
            <i style={{ width: '64%' }} />
            <i style={{ width: '38%' }} />
          </div>
          <div class='chat-msg chat-ai'>
            <span class='chat-who'>assistant</span>
            <i style={{ width: '88%' }} />
            <i style={{ width: '72%' }} />
            <i style={{ width: '54%' }} />
          </div>
        </div>
      );
    case 'agent':
      return (
        <div class='viz viz-agent' aria-hidden='true'>
          <div class='viz-bar'>
            <span class='viz-chip'>agent run</span>
            <span class='viz-dots'>● ● ●</span>
          </div>
          <ul class='run-log'>
            <li><span class='run-k'>→ tool</span> search(&quot;…&quot;)</li>
            <li><span class='run-k'>→ edit</span> report.md</li>
            <li><span class='run-k'>→ run</span> build &amp; test</li>
            <li class='run-ok'><span>✓ done</span> 3 steps</li>
          </ul>
        </div>
      );
    case 'memory':
      return (
        <div class='viz viz-memory' aria-hidden='true'>
          <For each={[0, 1, 2]}>
            {(n) => (
              <div class='mem-card' style={{ '--i': String(n) }}>
                <span class='mem-tag'>remembered</span>
                <i style={{ width: n === 2 ? '52%' : n === 1 ? '74%' : '90%' }} />
              </div>
            )}
          </For>
        </div>
      );
    case 'space':
      return (
        <div class='viz viz-space' aria-hidden='true'>
          <div class='space-list'>
            <span class='space-item is-active'>● work</span>
            <span class='space-item'>● personal</span>
            <span class='space-item'>● team</span>
          </div>
          <div class='app-grid'>
            <For each={['docs', 'slide', 'sheet', 'computer', 'social', '+']}>
              {(label) => <span class='app-tile'>{label}</span>}
            </For>
          </div>
        </div>
      );
  }
}

export default function Showcase(): JSX.Element {
  const t = useT();
  void reveal;
  return (
    <Section id='features' title={t.showcase.title} lede={t.showcase.lede}>
      <div class='showcase'>
        <For each={t.showcase.items}>
          {(item, i) => (
            <article class='showcase-row reveal' use:reveal={i() * 80}>
              <div class='showcase-copy'>
                <div class='showcase-eyebrow'>{String(i() + 1).padStart(2, '0')} · {item.key}</div>
                <h3>{item.name}</h3>
                <p class='showcase-tagline'>{item.tagline}</p>
                <p class='showcase-body'>
                  <RichText value={item.body} />
                </p>
                <ul class='showcase-points'>
                  <For each={item.points}>{(p) => <li>{p}</li>}</For>
                </ul>
              </div>
              <div class='showcase-visual'>
                <Visual kind={item.key} />
              </div>
            </article>
          )}
        </For>
      </div>
    </Section>
  );
}
