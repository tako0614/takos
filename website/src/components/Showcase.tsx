import { For, type JSX } from 'solid-js';
import Section from './Section';
import RichText from './RichText';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';
import type { ShowcaseItem } from '~/content/site';

/** Simplified renderings of the real takos app (web/src): the UnifiedSidebar
 *  shell plus the actual surface for each core — ChatPage, the agent Work
 *  board, MemoryPage, and the space Apps launcher. Labels and status
 *  vocabulary come from web/src/i18n/en. */
function Side(props: {
  mode: 'personal' | 'space';
  active?: 'chat' | 'memory';
}): JSX.Element {
  const nav = (key: 'chat' | 'memory', label: string) => (
    <span class={props.active === key ? 'ap-nav on' : 'ap-nav'}>{label}</span>
  );
  if (props.mode === 'space') {
    return (
      <div class='ap-side'>
        <span class='ap-back'>‹ work</span>
        <span class={props.active === 'chat' ? 'ap-nav ap-primary on' : 'ap-nav ap-primary'}>Chat</span>
        {nav('memory', 'Memory')}
        <span class='ap-nav'>Connections</span>
        <span class='ap-label'>Threads</span>
        <span class='ap-thread'>release notes</span>
        <span class='ap-thread'>takos-git triage</span>
        <span class='ap-thread'>weekly plan</span>
        <span class='ap-nav ap-foot'>Space Settings</span>
      </div>
    );
  }
  return (
    <div class='ap-side'>
      <span class='ap-logo'><span class='ap-mark' />takos</span>
      <span class='ap-nav ap-primary'>New Chat</span>
      {nav('memory', 'Memory')}
      <span class='ap-nav'>Connections</span>
      <span class='ap-nav'>Search</span>
      <span class='ap-label'>Projects</span>
      <span class='ap-thread'>work</span>
      <span class='ap-thread'>Personal</span>
    </div>
  );
}

function Visual(props: { kind: ShowcaseItem['key'] }): JSX.Element {
  switch (props.kind) {
    case 'chat':
      return (
        <div class='viz appviz' aria-hidden='true'>
          <Side mode='personal' />
          <div class='ap-main'>
            <div class='ap-head'>
              <span class='ap-model'>GPT-5.5 ▾</span>
            </div>
            <div class='ap-feed'>
              <div class='ap-bubble'>
                Draft the v0.12.7 release notes and save them to docs
              </div>
              <div class='ap-tools'>⚙ 3 tools executed · 8s ▶</div>
              <p class='ap-reply'>
                Drafted <code>release-notes-0.12.7.md</code> in docs — ready to
                review.
              </p>
            </div>
            <div class='ap-composer'>
              <span class='ap-placeholder'>Message...</span>
              <span class='ap-send'>↑</span>
            </div>
            <span class='ap-hint'>Shift + Enter for new line</span>
          </div>
        </div>
      );
    case 'agent':
      return (
        <div class='viz appviz' aria-hidden='true'>
          <Side mode='space' />
          <div class='ap-main'>
            <div class='ap-tabs'>
              <span class='on'>Work</span>
              <span>AI Model</span>
              <span>Skills</span>
              <span>Memory</span>
            </div>
            <div class='ap-pagehead'>
              <b>Work Tasks</b>
              <span class='ap-btn'>+ Add Task</span>
            </div>
            <div class='ap-card'>
              <div class='ap-card-top'>
                <b>Release notes for v0.12.7</b>
                <span class='ap-pill prog'>In Progress</span>
                <span class='ap-pri'>High</span>
              </div>
              <div class='ap-meta'>
                Agent: Execution Agent · Model: GPT-5.5
              </div>
              <div class='ap-meta'>Latest run: Run completed</div>
              <div class='ap-actions'>
                <span>Resume in Chat</span>
                <span>Complete</span>
              </div>
            </div>
            <div class='ap-card'>
              <div class='ap-card-top'>
                <b>Review open PRs on takos-git</b>
                <span class='ap-pill'>Planned</span>
                <span class='ap-pri'>Medium</span>
              </div>
              <div class='ap-actions'>
                <span>Start</span>
              </div>
            </div>
          </div>
        </div>
      );
    case 'memory':
      return (
        <div class='viz appviz' aria-hidden='true'>
          <Side mode='personal' active='memory' />
          <div class='ap-main'>
            <div class='ap-tabs'>
              <span class='on'>Memories (2)</span>
              <span>Reminders (1)</span>
            </div>
            <div class='ap-search'>Search memories...</div>
            <div class='ap-filters'>
              <span class='on'>All</span>
              <span>📅 Episode</span>
              <span>💡 Knowledge</span>
              <span>📋 Procedure</span>
            </div>
            <div class='ap-mem'>
              <div class='ap-card'>
                <div class='ap-card-top'>
                  <span class='ap-meta'>💡 Knowledge</span>
                  <span class='ap-chip'>project</span>
                </div>
                <p class='ap-mem-body'>
                  Release notes are drafted in docs via takos-office.
                </p>
                <div class='ap-mem-foot'>
                  <span>★★★★☆</span>
                  <span>9/24</span>
                </div>
              </div>
              <div class='ap-card'>
                <div class='ap-card-top'>
                  <span class='ap-meta'>📅 Episode</span>
                </div>
                <p class='ap-mem-body'>
                  Asked for a v0.12.7 changelog draft.
                </p>
                <div class='ap-mem-foot'>
                  <span>★★★☆☆</span>
                  <span>9/23</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    case 'space':
      return (
        <div class='viz appviz' aria-hidden='true'>
          <Side mode='space' active='chat' />
          <div class='ap-main'>
            <div class='ap-pagehead'>
              <b>Apps</b>
              <span class='ap-btn'>Add from Git URL</span>
            </div>
            <div class='ap-meta'>3 installed · 1 Capsule</div>
            <div class='ap-launcher'>
              <div class='ap-tile'>
                <span class='ap-tile-ic'>O</span>
                <span>takos-office</span>
              </div>
              <div class='ap-tile'>
                <span class='ap-tile-ic'>C</span>
                <span>takos-computer</span>
              </div>
              <div class='ap-tile'>
                <span class='ap-tile-ic'>S</span>
                <span>social</span>
              </div>
            </div>
            <div class='ap-capsule'>
              <b>Takosumi Capsules</b>
              <span class='ap-meta'>takos-office · 3/3 outputs ready</span>
            </div>
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
