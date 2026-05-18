import { CLOUD_INSTALL_URL } from '~/lib/cloud-url';
import CodeBlock from './CodeBlock';

export default function InstallCTA() {
  return (
    <section id='install' class='end-cta'>
      <div class='container'>
        <span class='eyebrow'>install</span>
        <h2>始めるには 2 通り。</h2>
        <p class='lede'>
          Takos は Takosumi 上で動くので、 Takosumi Cloud から 1-click install できる。 自分の cloud / 自前 VM
          で動かしたいなら、 <code>.takosumi.yml</code> AppSpec を install lifecycle に渡す。
        </p>
        <div class='install-options'>
          <div class='install-card install-card-highlight'>
            <h3>1-click install — Takosumi Cloud</h3>
            <p>
              ボタンを押すと cloud.takosumi.com の install wizard が開き、 git URL + ref が pre-fill された状態で
              dry-run → install できる。
            </p>
            <a class='btn btn-primary' href={CLOUD_INSTALL_URL} rel='noopener'>
              Cloud で install →
            </a>
          </div>
          <div class='install-card'>
            <h3>Self-host — takosumi CLI</h3>
            <p>
              自前の Takosumi substrate に install したい人向け。AppSpec を 1 行変えるだけで AWS / GCP / Cloudflare /
              docker / VM の provider target に届く。
            </p>
            <CodeBlock terminal>
              <span class='k'>$</span> deno install -gA -n takosumi \{'\n'}
              &nbsp;&nbsp;jsr:@takos/takosumi-cli{'\n'}
              <span class='k'>$</span> takosumi install --source . --space my-space
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}
