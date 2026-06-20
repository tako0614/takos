import { For, Show } from 'solid-js';
import Section from './Section';
import CodeBlock from './CodeBlock';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';
import type { InstallCard } from '~/content/site';

export default function InstallCTA() {
  const t = useT();
  const cloud = useCloudUrls();
  void reveal;

  const href = (kind: InstallCard['kind']) => (kind === 'use' ? cloud().useTakos : cloud().install);

  return (
    <Section
      splat
      id='install'
      class='end-cta'
      eyebrow={t.install.eyebrow}
      title={t.install.title}
      lede={<RichText value={t.install.lede} />}
    >
      <div class='install-options'>
        <For each={t.install.cards}>
          {(c, i) => (
            <div
              class='install-card reveal'
              classList={{ 'install-card-highlight': c.kind === 'use' }}
              use:reveal={i() * 80}
            >
              <h3>{c.title}</h3>
              <p>{c.body}</p>
              <Show
                when={c.kind !== 'self'}
                fallback={
                  <CodeBlock terminal>
                    <span class='k'>$</span> git clone https://github.com/tako0614/takos.git{'\n'}
                    <span class='k'>$</span> cd takos{'\n'}
                    <span class='k'>$</span> tofu -chdir=deploy/opentofu init{'\n'}
                    <span class='k'>$</span> tofu -chdir=deploy/opentofu apply -var target=cloudflare
                  </CodeBlock>
                }
              >
                <a
                  class={`btn ${c.kind === 'use' ? 'btn-primary' : 'btn-secondary'}`}
                  href={href(c.kind)}
                  rel='noopener'
                >
                  {c.cta}
                  {c.kind === 'use' ? ' →' : ''}
                </a>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Section>
  );
}
