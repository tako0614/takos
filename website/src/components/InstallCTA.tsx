import { CLOUD_INSTALL_URL } from "~/lib/cloud-url";
import CodeBlock from "./CodeBlock";

export default function InstallCTA() {
  return (
    <section id="install" class="end-cta">
      <div class="container">
        <span class="eyebrow">install</span>
        <h2>始めるには 2 通り。</h2>
        <p class="lede">
          Takos は Takosumi 上で動くので、 Takosumi Cloud から 1-click install できる。
          自分の cloud / 自前 VM で動かしたいなら、 manifest を <code>takosumi deploy</code> に渡すだけ。
        </p>
        <div class="install-options">
          <div class="install-card install-card-highlight">
            <h3>1-click install — Takosumi Cloud</h3>
            <p>
              ボタンを押すと cloud.takosumi.com の install wizard が開き、
              git URL + ref が pre-fill された状態で preview → install できる。
            </p>
            <a class="btn btn-primary" href={CLOUD_INSTALL_URL} rel="noopener">
              Cloud で install →
            </a>
          </div>
          <div class="install-card">
            <h3>Self-host — takosumi CLI</h3>
            <p>
              自前の Takosumi kernel に直接 deploy したい人向け。
              manifest を 1 行変えるだけで AWS / GCP / Cloudflare / docker / VM に届く。
            </p>
            <CodeBlock terminal>
              <span class="k">$</span> deno install -gA -n takosumi \{"\n"}
              {"  "}jsr:@takos/takosumi-cli{"\n"}
              <span class="k">$</span> takosumi deploy ./takos.manifest.yml
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}
