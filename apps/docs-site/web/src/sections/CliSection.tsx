import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, Table, H2, P } from '../components/primitives';

function CliSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>エンドポイント管理</H2>
          <CodeBlock>{`# 切り替え
takos endpoint use test
takos endpoint use prod
takos endpoint use https://api.takos.dev

# 確認
takos endpoint show`}</CodeBlock>

          <H2>API 呼び出し</H2>
          <CodeBlock>{`# GET
takos api call GET /api/spaces

# POST
takos api post /api/spaces --body '{"name": "my-space"}'`}</CodeBlock>

          <H2>リソース別ショートカット</H2>
          <CodeBlock>{`takos space get /
takos thread post /THREAD_ID/messages --body '{"content": "hello"}'
takos repo get /REPO_ID/branches`}</CodeBlock>

          <H2>デプロイ</H2>
          <CodeBlock>{`takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos deploy validate
takos deploy status --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID`}</CodeBlock>

          <H2>リクエストオプション</H2>
          <Table
            headers={['オプション', '説明']}
            rows={[
              ['`--query key=value`', 'クエリパラメータ'],
              ['`--header key=value`', 'リクエストヘッダー'],
              ['`--body`', 'JSON ボディ'],
              ['`--body-file`', 'JSON ボディ（ファイル指定）'],
              ['`--raw-body`', 'Raw ボディ'],
              ['`--raw-body-file`', 'Raw ボディ（ファイル指定）'],
              ['`--form`', 'フォームフィールド'],
              ['`--form-file`', 'フォームファイル'],
              ['`--space`', 'Space ID'],
              ['`--output`', '出力ファイル'],
              ['`--json`', 'JSON 出力'],
            ]}
          />

          <H2>認証</H2>
          <CodeBlock>{`# ログイン（ブラウザ OAuth）
takos login

# PAT を使用
takos api call GET /api/spaces --header "Authorization=Bearer tak_pat_..."}`}</CodeBlock>
        </div>
      }
      en={
        <div>
          <H2>Endpoint Management</H2>
          <CodeBlock>{`# Switch
takos endpoint use test
takos endpoint use prod
takos endpoint use https://api.takos.dev

# Show current
takos endpoint show`}</CodeBlock>

          <H2>API Calls</H2>
          <CodeBlock>{`# GET
takos api call GET /api/spaces

# POST
takos api post /api/spaces --body '{"name": "my-space"}'`}</CodeBlock>

          <H2>Resource Shortcuts</H2>
          <CodeBlock>{`takos space get /
takos thread post /THREAD_ID/messages --body '{"content": "hello"}'
takos repo get /REPO_ID/branches`}</CodeBlock>

          <H2>Deploy</H2>
          <CodeBlock>{`takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos deploy validate
takos deploy status --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID`}</CodeBlock>

          <H2>Request Options</H2>
          <Table
            headers={['Option', 'Description']}
            rows={[
              ['`--query key=value`', 'Query parameter'],
              ['`--header key=value`', 'Request header'],
              ['`--body`', 'JSON body'],
              ['`--body-file`', 'JSON body from file'],
              ['`--raw-body`', 'Raw body'],
              ['`--raw-body-file`', 'Raw body from file'],
              ['`--form`', 'Form field'],
              ['`--form-file`', 'Form file field'],
              ['`--space`', 'Space ID'],
              ['`--output`', 'Output file'],
              ['`--json`', 'JSON output'],
            ]}
          />

          <H2>Authentication</H2>
          <CodeBlock>{`# Login (browser OAuth)
takos login

# Use PAT
takos api call GET /api/spaces --header "Authorization=Bearer tak_pat_..."}`}</CodeBlock>
        </div>
      }
    />
  );
}

export default CliSection;
