# MCP Server

> このページでわかること: MCP Server を Takos 上で構築・デプロイする手順。manifest の各フィールド、Worker の実装、ローカルテスト、認証設定を含む完全な例。

## 完成形

```text
my-tools/
├── .takos/
│   ├── app.yml
│   └── workflows/
│       └── deploy.yml
├── src/
│   └── index.ts
└── package.json
```

## app.yml

```yaml
name: my-tools

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    readiness: /mcp

storage:
  mcp-auth-secret:
    type: secret
    bind: MCP_AUTH_TOKEN
    generate: true

routes:
  - path: /mcp
    target: web

publish:
  - type: McpServer
    name: my-tools
    path: /mcp
    transport: streamable-http
    authSecretRef: mcp-auth-secret
```

この Worker は `/mcp` でしか応答しないため、`compute.web.readiness: /mcp` で
deploy 時の readiness probe path を明示します。default は `GET /` ですが、
root path が存在しないこの例では override が必要です。

### manifest フィールド解説

| フィールド | 説明 |
| --- | --- |
| `compute.web` | MCP リクエストを処理する Worker。`build.fromWorkflow` でビルド成果物を参照する |
| `compute.web.readiness` | deploy 時の readiness probe path。default は `GET /`。MCP-only Worker のように root を持たない場合は `/mcp` 等を指定する |
| `routes[].target` | ルーティング先の Worker 名 |
| `routes[].path` | MCP endpoint のパス |
| `storage.mcp-auth-secret` | 認証トークン用のシークレット。`generate: true` で apply 時に自動生成される |
| `publish[].type` | publication の種類。MCP Server の場合は `McpServer` |
| `publish[].name` | MCP Server 名。agent が server をロードするときの識別子 |
| `publish[].path` | MCP endpoint のパス |
| `publish[].transport` | トランスポート方式。現在は `streamable-http` のみ |
| `publish[].authSecretRef` | 認証に使う `secret` resource の名前。省略可 |

## ワークフロー

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  bundle:
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
    artifacts:
      web:
        path: dist/worker
```

## Worker のコード

```typescript
// src/index.ts
interface Env {
  MCP_AUTH_TOKEN: string;
}

// MCP ツール定義
const TOOLS = [
  {
    name: "get_current_time",
    description: "現在の UTC 時刻を返す",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "calculate",
    description: "四則演算を実行する",
    inputSchema: {
      type: "object" as const,
      properties: {
        expression: {
          type: "string",
          description: "計算式（例: 2 + 3 * 4）",
        },
      },
      required: ["expression"],
    },
  },
];

// ツールの実行
function executeTool(
  name: string,
  args: Record<string, unknown>,
): { content: { type: string; text: string }[] } {
  switch (name) {
    case "get_current_time":
      return {
        content: [{ type: "text", text: new Date().toISOString() }],
      };
    case "calculate": {
      const expr = args.expression as string;
      // 安全な計算のみ許可
      const result = Function(`"use strict"; return (${expr})`)();
      return {
        content: [{ type: "text", text: String(result) }],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 認証チェック
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json() as {
      method: string;
      id?: string | number;
      params?: Record<string, unknown>;
    };

    // JSON-RPC ハンドリング
    switch (body.method) {
      case "initialize":
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "my-tools", version: "0.1.0" },
          },
        });

      case "tools/list":
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: TOOLS },
        });

      case "tools/call": {
        const params = body.params as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        try {
          const result = executeTool(params.name, params.arguments ?? {});
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result,
          });
        } catch (e) {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32603,
              message: (e as Error).message,
            },
          });
        }
      }

      default:
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        });
    }
  },
};
```

## ローカルテスト

Worker をビルドしてから、curl で MCP endpoint をテストできます。

```bash
# ビルド
npm run build

# ローカルで Worker を起動（wrangler を使う場合）
npx wrangler dev dist/worker/index.js --var MCP_AUTH_TOKEN=test-token
```

別のターミナルからリクエストを送ります。

```bash
# initialize
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'

# ツール一覧
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'

# ツール実行
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_current_time",
      "arguments": {}
    }
  }'
```

## MCP Client からの呼び出し

deploy 後、MCP Client から server をロードしてツールを呼び出せます。

```typescript
// MCP client からの接続例
const response = await fetch("https://my-tools.example.com/mcp", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${mcpAuthToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "calculate",
      arguments: { expression: "2 + 3 * 4" },
    },
  }),
});

const result = await response.json();
// { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "14" }] } }
```

## 認証の仕組み

`publish` で `authSecretRef` を指定すると、deploy 時にシークレットが自動生成され、Worker の環境変数にバインドされます。

| 設定 | 動作 |
| --- | --- |
| `authSecretRef` あり | Worker に `MCP_AUTH_TOKEN` が注入される。クライアントは Bearer トークンとして送信 |
| `authSecretRef` なし | 認証なし。パブリックな MCP endpoint になる |
| `generate: true` | apply 時にランダムなトークンを自動生成 |

::: danger 認証なしの MCP Server
`authSecretRef` を省略するとパブリックなエンドポイントになります。外部に公開する場合は必ず認証を設定してください。
:::

## デプロイ

```bash
# manifest を検証（dry-run preview）
takos deploy --plan

# staging にデプロイ
takos deploy --env staging

# production にデプロイ
takos deploy --env production
```

deploy 後、control plane が MCP endpoint を登録し、agent 側が server をロードできるようになります。

## ポイント

- `transport` は現在 `streamable-http` のみ対応しています
- MCP Server は JSON-RPC 2.0 プロトコルに従います
- `publish` の `path` は app 内のパスを指定します

## 関連ページ

- [MCP Server 仕様](/apps/mcp) --- app.yml の `publish` (`type: McpServer`) の詳細
- [Worker だけのシンプルなアプリ](/examples/simple-worker) --- Worker の基本構成
- [Worker + Container](/examples/worker-with-container) --- コンテナとの組み合わせ
- [app.yml](/apps/manifest) --- manifest の全体像
