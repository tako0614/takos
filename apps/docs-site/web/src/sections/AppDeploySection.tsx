import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, Endpoint, H2, H3, P, Table } from '../components/primitives';

function AppDeploySection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>app.yml マニフェスト</H2>
          <P>リポジトリの .takos/app.yml でデプロイ設定を定義します。複数の YAML ドキュメントを --- で区切って記述します。</P>

          <H3>最小構成</H3>
          <CodeBlock>{`# .takos/app.yml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
---
kind: Workload
metadata:
  name: api
spec:
  type: cloudflare.worker
---
kind: Endpoint
metadata:
  name: main
spec:
  protocol: http
  targetRef: api`}</CodeBlock>

          <H3>リソース付きの例</H3>
          <CodeBlock>{`apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
  description: "My application"
  category: app
---
kind: Resource
metadata:
  name: DB
spec:
  type: d1
  migrations: migrations/
---
kind: Resource
metadata:
  name: STORAGE
spec:
  type: r2
---
kind: Workload
metadata:
  name: api
spec:
  type: cloudflare.worker
---
kind: Binding
metadata:
  name: db-binding
spec:
  from: DB
  to: api
---
kind: Binding
metadata:
  name: storage-binding
spec:
  from: STORAGE
  to: api
---
kind: Endpoint
metadata:
  name: main
spec:
  protocol: http
  targetRef: api`}</CodeBlock>

          <H3>オブジェクト種別</H3>
          <Table
            headers={['Kind', '必須', '説明']}
            rows={[
              ['`Package`', '1 つ必須', 'アプリのメタデータ（name, version, category 等）'],
              ['`Workload`', '任意', '実行単位の定義（type: cloudflare.worker）'],
              ['`Endpoint`', '任意', 'HTTP エンドポイント（targetRef で Workload を指定）'],
              ['`Resource`', '任意', 'リソース定義（type: d1 / r2 / kv）'],
              ['`Binding`', '任意', 'Resource と Workload の紐付け'],
              ['`McpServer`', '任意', 'MCP サーバーの公開（endpointRef で Endpoint を指定）'],
            ]}
          />

          <H2>CLI コマンド</H2>
          <CodeBlock>{`# デプロイ
takos deploy --space SPACE_ID --repo REPO_ID --ref main

# マニフェスト検証
takos deploy validate

# ステータス確認
takos deploy status --space SPACE_ID

# ロールバック
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID`}</CodeBlock>

          <H2>Deploy API</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments" desc="デプロイ作成" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments" desc="一覧" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments/:id" desc="詳細" />
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments/:id/rollback" desc="ロールバック" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId/app-deployments/:id" desc="削除" />
          </div>

          <H2>Worker 管理 API</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/space/:spaceId" desc="一覧" />
            <Endpoint method="POST" path="/api/workers" desc="作成" />
            <Endpoint method="GET" path="/api/workers/:id" desc="詳細" />
            <Endpoint method="PATCH" path="/api/workers/:id/settings" desc="設定更新" />
            <Endpoint method="DELETE" path="/api/workers/:id" desc="削除" />
            <Endpoint method="GET" path="/api/workers/:id/deployments" desc="デプロイ履歴" />
            <Endpoint method="POST" path="/api/workers/:id/deployments/rollback" desc="ロールバック" />
          </div>

          <H2>カスタムドメイン</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/:id/domains" desc="一覧" />
            <Endpoint method="POST" path="/api/workers/:id/domains" desc="追加" />
            <Endpoint method="POST" path="/api/workers/:id/domains/verify" desc="DNS 検証" />
            <Endpoint method="DELETE" path="/api/workers/:id/domains/:domain" desc="削除" />
          </div>

          <H3>設定手順</H3>
          <CodeBlock>{`1. POST /api/workers/:id/domains でドメインを登録
   → レスポンスで検証トークンを取得

2. DNS に TXT レコードを追加:
   _takos-verify.yourdomain.com  TXT  "takos-verify={token}"

3. POST /api/workers/:id/domains/verify で検証
   → 成功すると SSL 証明書が自動発行され、ルーティングが有効化`}</CodeBlock>
        </div>
      }
      en={
        <div>
          <H2>app.yml Manifest</H2>
          <P>Define your deployment in .takos/app.yml. Use multiple YAML documents separated by ---.</P>

          <H3>Minimal Example</H3>
          <CodeBlock>{`# .takos/app.yml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
---
kind: Workload
metadata:
  name: api
spec:
  type: cloudflare.worker
---
kind: Endpoint
metadata:
  name: main
spec:
  protocol: http
  targetRef: api`}</CodeBlock>

          <H3>Example with Resources</H3>
          <CodeBlock>{`apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
  description: "My application"
  category: app
---
kind: Resource
metadata:
  name: DB
spec:
  type: d1
  migrations: migrations/
---
kind: Resource
metadata:
  name: STORAGE
spec:
  type: r2
---
kind: Workload
metadata:
  name: api
spec:
  type: cloudflare.worker
---
kind: Binding
metadata:
  name: db-binding
spec:
  from: DB
  to: api
---
kind: Binding
metadata:
  name: storage-binding
spec:
  from: STORAGE
  to: api
---
kind: Endpoint
metadata:
  name: main
spec:
  protocol: http
  targetRef: api`}</CodeBlock>

          <H3>Object Kinds</H3>
          <Table
            headers={['Kind', 'Required', 'Description']}
            rows={[
              ['`Package`', 'Exactly 1', 'App metadata (name, version, category, etc.)'],
              ['`Workload`', 'Optional', 'Execution unit (type: cloudflare.worker)'],
              ['`Endpoint`', 'Optional', 'HTTP endpoint (targetRef references a Workload)'],
              ['`Resource`', 'Optional', 'Resource definition (type: d1 / r2 / kv)'],
              ['`Binding`', 'Optional', 'Links a Resource to a Workload'],
              ['`McpServer`', 'Optional', 'Expose an MCP server (endpointRef references an Endpoint)'],
            ]}
          />

          <H2>CLI Commands</H2>
          <CodeBlock>{`# Deploy
takos deploy --space SPACE_ID --repo REPO_ID --ref main

# Validate manifest
takos deploy validate

# Check status
takos deploy status --space SPACE_ID

# Rollback
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID`}</CodeBlock>

          <H2>Deploy API</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments" desc="Create deployment" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments" desc="List" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments/:id" desc="Get" />
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments/:id/rollback" desc="Rollback" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId/app-deployments/:id" desc="Delete" />
          </div>

          <H2>Worker Management API</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/space/:spaceId" desc="List" />
            <Endpoint method="POST" path="/api/workers" desc="Create" />
            <Endpoint method="GET" path="/api/workers/:id" desc="Get" />
            <Endpoint method="PATCH" path="/api/workers/:id/settings" desc="Update settings" />
            <Endpoint method="DELETE" path="/api/workers/:id" desc="Delete" />
            <Endpoint method="GET" path="/api/workers/:id/deployments" desc="Deployment history" />
            <Endpoint method="POST" path="/api/workers/:id/deployments/rollback" desc="Rollback" />
          </div>

          <H2>Custom Domains</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/:id/domains" desc="List" />
            <Endpoint method="POST" path="/api/workers/:id/domains" desc="Add" />
            <Endpoint method="POST" path="/api/workers/:id/domains/verify" desc="Verify DNS" />
            <Endpoint method="DELETE" path="/api/workers/:id/domains/:domain" desc="Remove" />
          </div>

          <H3>Setup Steps</H3>
          <CodeBlock>{`1. POST /api/workers/:id/domains to register domain
   → Response includes a verification token

2. Add a TXT record to your DNS:
   _takos-verify.yourdomain.com  TXT  "takos-verify={token}"

3. POST /api/workers/:id/domains/verify
   → On success, SSL certificate is auto-provisioned and routing is enabled`}</CodeBlock>
        </div>
      }
    />
  );
}

export default AppDeploySection;
