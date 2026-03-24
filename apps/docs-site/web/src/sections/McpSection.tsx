import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, Table, H2, H3, P, Endpoint } from '../components/primitives';

function McpSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>概要</H2>
          <P>
            MCP サーバーを登録して、Agent が使えるツールを拡張できます。
          </P>

          <H2>サーバー種別</H2>
          <Table
            headers={['種別', '説明']}
            rows={[
              ['External', 'URL を指定して登録する外部 MCP サーバー'],
              ['Worker', 'Takos にデプロイした Worker が提供する MCP サーバー'],
              ['Bundle', 'アプリデプロイから自動登録される MCP サーバー'],
            ]}
          />

          <H2>登録 API</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/mcp/servers?spaceId=..." desc="登録" />
            <Endpoint method="GET" path="/api/mcp/servers?spaceId=..." desc="一覧" />
            <Endpoint method="PATCH" path="/api/mcp/servers/:id?spaceId=..." desc="更新" />
            <Endpoint method="DELETE" path="/api/mcp/servers/:id?spaceId=..." desc="削除" />
          </div>

          <H3>Agent からの登録</H3>
          <CodeBlock>{`// mcp_add_server ツール
{
  "url": "https://mcp.example.com",
  "name": "my_mcp",
  "scope": "read write"
}`}</CodeBlock>
          <Table
            headers={['レスポンス', '説明']}
            rows={[
              ['`already_registered`', '同名サーバーが既に登録済み'],
              ['`registered`', '登録完了'],
              ['`pending_oauth`', 'OAuth 認証待ち'],
            ]}
          />

          <H2>OAuth 連携</H2>
          <P>
            外部 MCP サーバーが OAuth に対応している場合、登録時に OAuth 2.0 + PKCE で自動認証します。
            トークンの更新も自動です。
          </P>

          <H2>ツールの読み込み</H2>
          <P>
            Agent の Run 開始時、有効な MCP サーバーに自動接続してツールをロードします。
            ツール名が衝突する場合は サーバー名__ プレフィックスが付きます。
            接続に失敗したサーバーはスキップされます（Run は継続）。
          </P>
        </div>
      }
      en={
        <div>
          <H2>Overview</H2>
          <P>
            Register MCP servers to extend the tools available to the Agent.
          </P>

          <H2>Server Types</H2>
          <Table
            headers={['Type', 'Description']}
            rows={[
              ['External', 'External MCP server registered by URL'],
              ['Worker', 'MCP server provided by a Takos-deployed Worker'],
              ['Bundle', 'MCP server auto-registered from an app deployment'],
            ]}
          />

          <H2>Registration API</H2>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/mcp/servers?spaceId=..." desc="Register" />
            <Endpoint method="GET" path="/api/mcp/servers?spaceId=..." desc="List" />
            <Endpoint method="PATCH" path="/api/mcp/servers/:id?spaceId=..." desc="Update" />
            <Endpoint method="DELETE" path="/api/mcp/servers/:id?spaceId=..." desc="Delete" />
          </div>

          <H3>Registration via Agent</H3>
          <CodeBlock>{`// mcp_add_server tool
{
  "url": "https://mcp.example.com",
  "name": "my_mcp",
  "scope": "read write"
}`}</CodeBlock>
          <Table
            headers={['Response', 'Description']}
            rows={[
              ['`already_registered`', 'Server with same name already exists'],
              ['`registered`', 'Registration complete'],
              ['`pending_oauth`', 'Waiting for OAuth authentication'],
            ]}
          />

          <H2>OAuth Integration</H2>
          <P>
            If an external MCP server supports OAuth, authentication is handled
            automatically via OAuth 2.0 + PKCE on registration. Token refresh is also automatic.
          </P>

          <H2>Tool Loading</H2>
          <P>
            At Run startup, the Agent automatically connects to enabled MCP servers and loads their tools.
            On name collision, tools are prefixed with serverName__.
            Servers that fail to connect are skipped (the Run continues).
          </P>
        </div>
      }
    />
  );
}

export default McpSection;
