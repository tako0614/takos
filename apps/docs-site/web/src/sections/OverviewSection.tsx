import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, H2, P, Table } from '../components/primitives';

function OverviewSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>Takos とは</H2>
          <P>
            Takos は AI agent・Git hosting・アプリデプロイ・ルーティングを
            1 つにまとめた開発プラットフォームです。
          </P>

          <H2>機能一覧</H2>
          <Table
            headers={['機能', '概要']}
            rows={[
              ['AI Agent', 'ファイル操作・コード実行・Web 検索などを実行できる非同期 AI agent'],
              ['Git Hosting', '標準の Git クライアントで clone / push / fetch できる built-in Git'],
              ['Deploy', '.takos/app.yml を置いて takos deploy するだけでアプリを公開'],
              ['Routing', 'テナント単位のカスタムドメイン設定'],
              ['CLI', 'takos コマンドで API 操作・デプロイ・管理を実行'],
              ['MCP', '外部 MCP サーバーを登録して Agent のツールを拡張'],
            ]}
          />

          <H2>構成</H2>
          <CodeBlock>{`takos.jp（管理側）
├── Web UI
├── API（認証・Space・Agent・Git・Worker 管理）
├── Git（https://takos.jp/git/:repoId）
└── CLI（takos コマンド）

*.app.takos.jp / カスタムドメイン（公開側）
└── デプロイしたアプリ`}</CodeBlock>
        </div>
      }
      en={
        <div>
          <H2>What is Takos</H2>
          <P>
            Takos is a development platform that combines AI agents, Git hosting,
            app deployment, and routing in one place.
          </P>

          <H2>Features</H2>
          <Table
            headers={['Feature', 'Description']}
            rows={[
              ['AI Agent', 'Async AI agent that can edit files, run code, search the web, and more'],
              ['Git Hosting', 'Built-in Git with standard clone / push / fetch via any Git client'],
              ['Deploy', 'Add .takos/app.yml and run takos deploy to publish your app'],
              ['Routing', 'Per-tenant custom domain configuration'],
              ['CLI', 'takos command for API calls, deploys, and management'],
              ['MCP', 'Register external MCP servers to extend Agent tools'],
            ]}
          />

          <H2>Structure</H2>
          <CodeBlock>{`takos.jp (admin)
├── Web UI
├── API (auth, spaces, agent, git, workers)
├── Git (https://takos.jp/git/:repoId)
└── CLI (takos command)

*.app.takos.jp / custom domain (public)
└── Deployed apps`}</CodeBlock>
        </div>
      }
    />
  );
}

export default OverviewSection;
