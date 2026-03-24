import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, Table, H2, P, Endpoint } from '../components/primitives';

function ApiSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>Base URL</H2>
          <CodeBlock>{`https://takos.jp`}</CodeBlock>

          <H2>認証</H2>
          <P>ほとんどのエンドポイントは認証が必要です。</P>
          <Table
            headers={['種別', '形式', '用途']}
            rows={[
              ['Session', 'Cookie / Bearer', 'ブラウザセッション'],
              ['PAT', '`tak_pat_...`', 'CLI / API 呼び出し'],
            ]}
          />
          <CodeBlock>{`curl -H "Authorization: Bearer tak_pat_xxxxxxxxxxxx" \\
  https://takos.jp/api/spaces`}</CodeBlock>

          <H2>エラーレスポンス</H2>
          <P>全エンドポイント共通のエラー形式:</P>
          <CodeBlock>{`{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": {}  // 省略される場合あり
}`}</CodeBlock>
          <Table
            headers={['ステータス', 'コード', '説明']}
            rows={[
              ['400', '`BAD_REQUEST`', '不正なリクエスト'],
              ['401', '`UNAUTHORIZED`', '認証が必要'],
              ['403', '`FORBIDDEN`', '権限不足'],
              ['404', '`NOT_FOUND`', 'リソースが見つからない'],
              ['409', '`CONFLICT`', '競合（名前の重複等）'],
              ['422', '`VALIDATION_ERROR`', 'バリデーションエラー'],
              ['429', '`RATE_LIMITED`', 'レート制限'],
            ]}
          />

          <H2>Auth</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/auth/google" desc="Google OAuth 開始" />
            <Endpoint method="GET" path="/auth/google/callback" desc="コールバック" />
            <Endpoint method="POST" path="/api/auth/logout" desc="ログアウト" />
            <Endpoint method="GET" path="/api/auth/me" desc="現在のユーザー" />
            <Endpoint method="POST" path="/api/auth/pat" desc="PAT 発行" />
            <Endpoint method="GET" path="/api/auth/pat" desc="PAT 一覧" />
            <Endpoint method="DELETE" path="/api/auth/pat/:id" desc="PAT 削除" />
          </div>

          <H2>Spaces</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/spaces" />
            <Endpoint method="POST" path="/api/spaces" />
            <Endpoint method="GET" path="/api/spaces/:spaceId" />
            <Endpoint method="PATCH" path="/api/spaces/:spaceId" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId" />
          </div>

          <H2>Repos</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/repos" desc="作成" />
            <Endpoint method="GET" path="/api/repos/:id" />
            <Endpoint method="GET" path="/api/repos/:id/branches" />
            <Endpoint method="POST" path="/api/repos/:id/branches" />
            <Endpoint method="DELETE" path="/api/repos/:id/branches/:name" />
            <Endpoint method="POST" path="/api/repos/:id/fork" />
            <Endpoint method="POST" path="/api/repos/:id/fetch" />
            <Endpoint method="POST" path="/api/repos/:id/sync" />
          </div>
          <CodeBlock>{`POST /api/spaces/:spaceId/repos
{
  "name": "my-app",
  "visibility": "private"  // "public" | "private" | "internal"
}`}</CodeBlock>

          <H2>Threads / Runs</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/threads" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/threads/:threadId" />
            <Endpoint method="POST" path="/api/threads/:threadId/messages" />
            <Endpoint method="POST" path="/api/threads/:threadId/runs" />
            <Endpoint method="GET" path="/api/runs/:runId" />
            <Endpoint method="POST" path="/api/runs/:runId/cancel" />
          </div>

          <H2>Workers</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/space/:spaceId" />
            <Endpoint method="POST" path="/api/workers" />
            <Endpoint method="GET" path="/api/workers/:id" />
            <Endpoint method="PATCH" path="/api/workers/:id/settings" />
            <Endpoint method="DELETE" path="/api/workers/:id" />
            <Endpoint method="GET" path="/api/workers/:id/deployments" />
            <Endpoint method="POST" path="/api/workers/:id/deployments/rollback" />
          </div>

          <H2>App Deployments</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments/:id" />
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments/:id/rollback" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId/app-deployments/:id" />
          </div>

          <H2>Custom Domains</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/:id/domains" />
            <Endpoint method="POST" path="/api/workers/:id/domains" />
            <Endpoint method="POST" path="/api/workers/:id/domains/verify" />
            <Endpoint method="DELETE" path="/api/workers/:id/domains/:domain" />
          </div>

          <H2>Storage</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/spaces/:spaceId/storage" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/storage/:fileId/content" />
            <Endpoint method="PUT" path="/api/spaces/:spaceId/storage/:fileId/content" />
            <Endpoint method="POST" path="/api/spaces/:spaceId/storage/files" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId/storage/:fileId" />
          </div>

          <H2>MCP Servers</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/mcp/servers?spaceId=..." />
            <Endpoint method="POST" path="/api/mcp/servers?spaceId=..." />
            <Endpoint method="PATCH" path="/api/mcp/servers/:id?spaceId=..." />
            <Endpoint method="DELETE" path="/api/mcp/servers/:id?spaceId=..." />
          </div>

          <H2>OAuth</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/mcp/oauth/callback" />
            <Endpoint method="GET" path="/.well-known/oauth-authorization-server" />
            <Endpoint method="POST" path="/oauth/token" />
            <Endpoint method="GET" path="/oauth/authorize" />
          </div>
        </div>
      }
      en={
        <div>
          <H2>Base URL</H2>
          <CodeBlock>{`https://takos.jp`}</CodeBlock>

          <H2>Authentication</H2>
          <P>Most endpoints require authentication.</P>
          <Table
            headers={['Type', 'Format', 'Usage']}
            rows={[
              ['Session', 'Cookie / Bearer', 'Browser session'],
              ['PAT', '`tak_pat_...`', 'CLI / API calls'],
            ]}
          />
          <CodeBlock>{`curl -H "Authorization: Bearer tak_pat_xxxxxxxxxxxx" \\
  https://takos.jp/api/spaces`}</CodeBlock>

          <H2>Error Responses</H2>
          <P>All endpoints use a common error format:</P>
          <CodeBlock>{`{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": {}  // may be omitted
}`}</CodeBlock>
          <Table
            headers={['Status', 'Code', 'Description']}
            rows={[
              ['400', '`BAD_REQUEST`', 'Invalid request'],
              ['401', '`UNAUTHORIZED`', 'Authentication required'],
              ['403', '`FORBIDDEN`', 'Insufficient permissions'],
              ['404', '`NOT_FOUND`', 'Resource not found'],
              ['409', '`CONFLICT`', 'Conflict (e.g. duplicate name)'],
              ['422', '`VALIDATION_ERROR`', 'Validation failed'],
              ['429', '`RATE_LIMITED`', 'Rate limit exceeded'],
            ]}
          />

          <H2>Auth</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/auth/google" desc="Start Google OAuth" />
            <Endpoint method="GET" path="/auth/google/callback" desc="Callback" />
            <Endpoint method="POST" path="/api/auth/logout" desc="Logout" />
            <Endpoint method="GET" path="/api/auth/me" desc="Current user" />
            <Endpoint method="POST" path="/api/auth/pat" desc="Create PAT" />
            <Endpoint method="GET" path="/api/auth/pat" desc="List PATs" />
            <Endpoint method="DELETE" path="/api/auth/pat/:id" desc="Delete PAT" />
          </div>

          <H2>Spaces</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/spaces" />
            <Endpoint method="POST" path="/api/spaces" />
            <Endpoint method="GET" path="/api/spaces/:spaceId" />
            <Endpoint method="PATCH" path="/api/spaces/:spaceId" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId" />
          </div>

          <H2>Repos</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/repos" desc="Create" />
            <Endpoint method="GET" path="/api/repos/:id" />
            <Endpoint method="GET" path="/api/repos/:id/branches" />
            <Endpoint method="POST" path="/api/repos/:id/branches" />
            <Endpoint method="DELETE" path="/api/repos/:id/branches/:name" />
            <Endpoint method="POST" path="/api/repos/:id/fork" />
            <Endpoint method="POST" path="/api/repos/:id/fetch" />
            <Endpoint method="POST" path="/api/repos/:id/sync" />
          </div>
          <CodeBlock>{`POST /api/spaces/:spaceId/repos
{
  "name": "my-app",
  "visibility": "private"  // "public" | "private" | "internal"
}`}</CodeBlock>

          <H2>Threads / Runs</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/threads" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/threads/:threadId" />
            <Endpoint method="POST" path="/api/threads/:threadId/messages" />
            <Endpoint method="POST" path="/api/threads/:threadId/runs" />
            <Endpoint method="GET" path="/api/runs/:runId" />
            <Endpoint method="POST" path="/api/runs/:runId/cancel" />
          </div>

          <H2>Workers</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/space/:spaceId" />
            <Endpoint method="POST" path="/api/workers" />
            <Endpoint method="GET" path="/api/workers/:id" />
            <Endpoint method="PATCH" path="/api/workers/:id/settings" />
            <Endpoint method="DELETE" path="/api/workers/:id" />
            <Endpoint method="GET" path="/api/workers/:id/deployments" />
            <Endpoint method="POST" path="/api/workers/:id/deployments/rollback" />
          </div>

          <H2>App Deployments</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/app-deployments/:id" />
            <Endpoint method="POST" path="/api/spaces/:spaceId/app-deployments/:id/rollback" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId/app-deployments/:id" />
          </div>

          <H2>Custom Domains</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/workers/:id/domains" />
            <Endpoint method="POST" path="/api/workers/:id/domains" />
            <Endpoint method="POST" path="/api/workers/:id/domains/verify" />
            <Endpoint method="DELETE" path="/api/workers/:id/domains/:domain" />
          </div>

          <H2>Storage</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/spaces/:spaceId/storage" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/storage/:fileId/content" />
            <Endpoint method="PUT" path="/api/spaces/:spaceId/storage/:fileId/content" />
            <Endpoint method="POST" path="/api/spaces/:spaceId/storage/files" />
            <Endpoint method="DELETE" path="/api/spaces/:spaceId/storage/:fileId" />
          </div>

          <H2>MCP Servers</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/mcp/servers?spaceId=..." />
            <Endpoint method="POST" path="/api/mcp/servers?spaceId=..." />
            <Endpoint method="PATCH" path="/api/mcp/servers/:id?spaceId=..." />
            <Endpoint method="DELETE" path="/api/mcp/servers/:id?spaceId=..." />
          </div>

          <H2>OAuth</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/mcp/oauth/callback" />
            <Endpoint method="GET" path="/.well-known/oauth-authorization-server" />
            <Endpoint method="POST" path="/oauth/token" />
            <Endpoint method="GET" path="/oauth/authorize" />
          </div>
        </div>
      }
    />
  );
}

export default ApiSection;
