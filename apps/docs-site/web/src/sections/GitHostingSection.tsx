import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, Endpoint, H2, Table } from '../components/primitives';

function GitHostingSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>基本仕様</H2>
          <Table
            headers={['項目', '値']}
            rows={[
              ['プロトコル', 'Git Smart HTTP v2 互換'],
              ['オブジェクト形式', 'SHA-1'],
              ['認証', 'HTTP Basic Auth + Personal Access Token'],
            ]}
          />

          <H2>clone / push / fetch</H2>
          <CodeBlock>{`git clone https://takos.jp/git/:repoId
git push origin main
git fetch origin`}</CodeBlock>

          <H2>ブランチ管理 API</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/repos/:id/branches" />
            <Endpoint method="POST" path="/api/repos/:id/branches" desc="作成" />
            <Endpoint method="DELETE" path="/api/repos/:id/branches/:branchName" />
            <Endpoint method="POST" path="/api/repos/:id/branches/:branchName/default" desc="デフォルトに設定" />
          </div>
          <CodeBlock>{`POST /api/repos/:id/branches
{
  "name": "feature/my-branch",
  "source": "main"
}`}</CodeBlock>

          <H2>コミット・ツリー閲覧</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/git/repos/:repoId/commits?ref=main&limit=50" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/commits/:sha" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/tree/:ref" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/tree/:ref/:path" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/blob/:ref?path=..." />
          </div>

          <H2>Fork / Fetch / Sync</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/repos/:id/fork" />
            <Endpoint method="POST" path="/api/repos/:id/fetch" />
            <Endpoint method="POST" path="/api/repos/:id/sync" />
            <Endpoint method="GET" path="/api/repos/:id/sync/status" />
          </div>

          <H2>コード検索</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/repos/:id/search?q=...&ref=main&limit=50" />
            <Endpoint method="GET" path="/api/repos/:id/log/:ref?path=src/main.ts" />
            <Endpoint method="GET" path="/api/repos/:id/blame/:ref?path=src/main.ts" />
          </div>

          <H2>エラーコード</H2>
          <Table
            headers={['コード', '説明']}
            rows={[
              ['`REF_CONFLICT`', '参照の競合'],
              ['`REPO_NOT_FOUND`', 'リポジトリが存在しない'],
              ['`PERMISSION_DENIED`', '権限不足'],
              ['`NOT_FAST_FORWARD`', 'Fast-forward できない'],
              ['`SYNC_CONFLICT`', 'マージコンフリクト'],
            ]}
          />
        </div>
      }
      en={
        <div>
          <H2>Specification</H2>
          <Table
            headers={['Property', 'Value']}
            rows={[
              ['Protocol', 'Git Smart HTTP v2 compatible'],
              ['Object Format', 'SHA-1'],
              ['Auth', 'HTTP Basic Auth + Personal Access Token'],
            ]}
          />

          <H2>clone / push / fetch</H2>
          <CodeBlock>{`git clone https://takos.jp/git/:repoId
git push origin main
git fetch origin`}</CodeBlock>

          <H2>Branch Management API</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/repos/:id/branches" />
            <Endpoint method="POST" path="/api/repos/:id/branches" desc="Create" />
            <Endpoint method="DELETE" path="/api/repos/:id/branches/:branchName" />
            <Endpoint method="POST" path="/api/repos/:id/branches/:branchName/default" desc="Set as default" />
          </div>
          <CodeBlock>{`POST /api/repos/:id/branches
{
  "name": "feature/my-branch",
  "source": "main"
}`}</CodeBlock>

          <H2>Commit &amp; Tree Browsing</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/git/repos/:repoId/commits?ref=main&limit=50" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/commits/:sha" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/tree/:ref" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/tree/:ref/:path" />
            <Endpoint method="GET" path="/api/git/repos/:repoId/blob/:ref?path=..." />
          </div>

          <H2>Fork / Fetch / Sync</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/repos/:id/fork" />
            <Endpoint method="POST" path="/api/repos/:id/fetch" />
            <Endpoint method="POST" path="/api/repos/:id/sync" />
            <Endpoint method="GET" path="/api/repos/:id/sync/status" />
          </div>

          <H2>Code Search</H2>
          <div className="space-y-0.5">
            <Endpoint method="GET" path="/api/repos/:id/search?q=...&ref=main&limit=50" />
            <Endpoint method="GET" path="/api/repos/:id/log/:ref?path=src/main.ts" />
            <Endpoint method="GET" path="/api/repos/:id/blame/:ref?path=src/main.ts" />
          </div>

          <H2>Error Codes</H2>
          <Table
            headers={['Code', 'Description']}
            rows={[
              ['`REF_CONFLICT`', 'Ref update conflict'],
              ['`REPO_NOT_FOUND`', 'Repository does not exist'],
              ['`PERMISSION_DENIED`', 'Insufficient permissions'],
              ['`NOT_FAST_FORWARD`', 'Cannot fast-forward'],
              ['`SYNC_CONFLICT`', 'Merge conflict'],
            ]}
          />
        </div>
      }
    />
  );
}

export default GitHostingSection;
