import { createSignal, onMount } from 'solid-js';
import { resolveCloudUrls } from '~/lib/cloud-url';
import CodeBlock from './CodeBlock';

export default function InstallCTA() {
  const [cloudUrls, setCloudUrls] = createSignal(resolveCloudUrls(''));
  onMount(() => setCloudUrls(resolveCloudUrls()));

  return (
    <section id='install' class='end-cta'>
      <div class='container'>
        <span class='eyebrow'>install</span>
        <h2>始めるには 3 通り。</h2>
        <p class='lede'>
          Takos は Takosumi 上で動くので、 Takosumi から 1-click install できる。 自分の cloud / 自前 VM
          で動かしたいなら、 Git または prepared source を Takosumi Source install lifecycle に渡す。
        </p>
        <div class='install-options'>
          <div class='install-card install-card-highlight'>
            <h3>Use Takos — Takosumi</h3>
            <p>
              一般ユーザー向け。Takosumi の account-plane entry で Account / Space / launch を進める。 public
              managed offering が閉じている間は launch readiness gate で止まる。
            </p>
            <a class='btn btn-primary' href={cloudUrls().useTakos} rel='noopener'>
              Use Takos →
            </a>
          </div>
          <div class='install-card'>
            <h3>Install from Git — Takosumi</h3>
            <p>
              ボタンを押すと accounts.takosumi.com の install wizard が開き、 git URL + ref が pre-fill された状態で
              dry-run → install できる。source を確認したい人や fork を使う人向け。
            </p>
            <a class='btn btn-secondary' href={cloudUrls().install} rel='noopener'>
              Git から install
            </a>
          </div>
          <div class='install-card'>
            <h3>Self-host — takosumi CLI</h3>
            <p>
              自前の Takosumi substrate に install したい人向け。provider target と PlatformService inventory は operator
              distribution 側で選び、source は同じ Git URL / ref で扱える。
            </p>
            <CodeBlock terminal>
              <span class='k'>$</span> bun x @takosjp/takosumi install dry-run \{'\n'}
              &nbsp;&nbsp;--source git:https://github.com/you/takos#main --space my-space{'\n'}
              <span class='k'>$</span> bun x @takosjp/takosumi install apply --expected reviewed.json
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}
