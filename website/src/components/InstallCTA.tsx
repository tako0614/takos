import { For, Show } from 'solid-js';
import Section from './Section';
import CodeBlock from './CodeBlock';
import RichText from './RichText';
import { useCloudUrls } from '~/lib/cloud';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';
import type { InstallCard } from '~/content/site';
import { TAKOS_INSTALL_REF } from '~/lib/takos-release.generated';

export default function InstallCTA() {
  const t = useT();
  const cloud = useCloudUrls();
  void reveal;

  const href = (kind: InstallCard['kind']) => (kind === 'use' ? cloud().useTakos : cloud().install);

  return (
    <Section
      id='install'
      class='end-cta'
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
                    <span class='k'>$</span> git fetch --tags origin{'\n'}
                    <span class='k'>$</span> git checkout --detach {TAKOS_INSTALL_REF}{'\n'}
                    <span class='k'>$</span> git rev-parse --verify {TAKOS_INSTALL_REF}{'\n'}
                    <span class='k'>$</span> bun install --frozen-lockfile{'\n'}
                    <span class='k'>$</span> bun run build:opentofu-worker-artifact{'\n'}
                    <span class='k'>$</span> install -d -m 700 "$HOME/.config/takos"{'\n'}
                    <span class='k'>$</span> cp deploy/opentofu/cloudflare/opentofu.tfvars.example "$HOME/.config/takos/takos.tfvars"{'\n'}
                    <span class='k'>$</span> chmod 600 "$HOME/.config/takos/takos.tfvars"{'\n'}
                    <span class='k'>$</span> <span class='c'># edit external tfvars before planning</span>{'\n'}
                    <span class='k'>$</span> tofu -chdir=deploy/opentofu/cloudflare init -input=false{'\n'}
                    <span class='k'>$</span> tofu -chdir=deploy/opentofu/cloudflare plan -input=false -var-file="$HOME/.config/takos/takos.tfvars" -out="$HOME/.config/takos/takos.tfplan"{'\n'}
                    <span class='k'>$</span> tofu show "$HOME/.config/takos/takos.tfplan"{'\n'}
                    <span class='k'>$</span> tofu -chdir=deploy/opentofu/cloudflare apply "$HOME/.config/takos/takos.tfplan"
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
