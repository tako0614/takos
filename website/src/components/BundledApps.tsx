import { For } from 'solid-js';

interface App {
  readonly name: string;
  readonly tag: string;
  readonly body: string;
}

const APPS: readonly App[] = [
  {
    name: 'takos-docs',
    tag: 'docs',
    body: 'ノート + ドキュメント。 Tiptap ベースのリッチテキストエディタ (将来 collaborative)。',
  },
  { name: 'takos-slide', tag: 'slides', body: 'プレゼン作成。 keynote/slides の代替。' },
  { name: 'takos-excel', tag: 'sheet', body: 'スプレッドシート。 calc + formula 対応。' },
  { name: 'takos-computer', tag: 'agent-tool', body: 'agent から呼び出せる computer use 環境。' },
  { name: 'yurucommu', tag: 'social', body: 'self-hosted ActivityPub / community social。 fediverse に繋がる。' },
];

export default function BundledApps() {
  return (
    <section id='apps'>
      <div class='container'>
        <span class='eyebrow'>bundled apps</span>
        <h2>新規 space で auto-install。</h2>
        <p class='lede'>
          Takos distribution と一緒に ship される 1st-party の InstallableApp。 新規 space 作成と同時に install 済み、
          必要なければ uninstall できる。
        </p>
        <div class='features'>
          <For each={APPS}>
            {(a) => (
              <article class='feature'>
                <h4>
                  {a.name} <span class='feature-tag'>{a.tag}</span>
                </h4>
                <p>{a.body}</p>
              </article>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
