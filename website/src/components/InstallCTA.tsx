import { resolveCloudInstallUrl, resolveCloudUseTakosUrl } from '~/lib/cloud-url';
import CodeBlock from './CodeBlock';

export default function InstallCTA() {
  const useTakosUrl = () => resolveCloudUseTakosUrl();
  const installUrl = () => resolveCloudInstallUrl();
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
            <h3>Use Takos — Takosumi Cloud</h3>
            <p>
              一般ユーザー向け。Takosumi Cloud の account-plane entry で Account / Space / launch を進める。 public
              managed offering が閉じている間は launch readiness gate で止まる。
            </p>
            <a class='btn btn-primary' href={useTakosUrl()} rel='noopener'>
              Use Takos →
            </a>
          </div>
          <div class='install-card'>
            <h3>Install from Git — Takosumi Cloud</h3>
            <p>
              ボタンを押すと cloud.takosumi.com の install wizard が開き、 git URL + ref が pre-fill された状態で
              dry-run → install できる。source を確認したい人や fork を使う人向け。
            </p>
            <a class='btn btn-secondary' href={installUrl()} rel='noopener'>
              Git から install
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
