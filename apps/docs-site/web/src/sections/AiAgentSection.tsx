import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, Table, H2, H3, P, Endpoint } from '../components/primitives';

function AiAgentSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H2>ステータス遷移</H2>
          <CodeBlock>{`queued → running → completed
                 ↘ failed
                 ↘ cancelled`}</CodeBlock>
          <P>
            メッセージを送信すると Run が作成されます。
            実行中のイベントは WebSocket でリアルタイムに配信されます。
          </P>

          <H2>Thread / Run API</H2>
          <H3>Thread</H3>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/threads" desc="作成" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/threads/:threadId" desc="取得" />
            <Endpoint method="POST" path="/api/threads/:threadId/messages" desc="メッセージ送信" />
          </div>

          <H3>Run</H3>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/threads/:threadId/runs" desc="作成" />
            <Endpoint method="GET" path="/api/runs/:runId" desc="取得" />
            <Endpoint method="POST" path="/api/runs/:runId/cancel" desc="キャンセル" />
          </div>

          <H2>WebSocket 接続</H2>
          <CodeBlock>{`// 接続
const ws = new WebSocket("wss://takos.jp/api/runs/{runId}/ws");

// 接続後、subscribe メッセージを送信
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "subscribe", runId: "..." }));
};

// イベント受信
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // event.type: "started" | "thinking" | "tool_call" | ...
  // event.data: イベント固有のデータ
  // event.eventId: 連番ID
};

// 途中から再接続する場合
const ws = new WebSocket(
  "wss://takos.jp/api/runs/{runId}/ws?last_event_id=42"
);`}</CodeBlock>
          <P>認証は既存のセッション Cookie または Bearer トークンが使用されます。</P>

          <H2>ビルトインツール</H2>
          <Table
            headers={['カテゴリ', 'ツール']}
            rows={[
              ['コンテナ', '`container_start`, `container_status`, `container_commit`, `container_stop`'],
              ['リポジトリ', '`create_repository`, `repo_list`, `repo_status`, `repo_switch`'],
              ['ファイル', '`file_read`, `file_write`, `file_list`, `file_delete`, `file_mkdir`, `file_rename`, `file_copy`'],
              ['コード実行', '`runtime_exec`, `runtime_status`'],
              ['検索・Web', '`search`, `web_fetch`, `web_search`, `store_search`'],
              ['Worker', '`worker_list`, `worker_create`, `worker_delete`, `worker_env_set`'],
              ['デプロイ', '`app_deployment_deploy_from_repo`, `app_deployment_list`, `app_deployment_rollback`'],
              ['MCP', '`mcp_add_server`, `mcp_list_servers`, `mcp_update_server`, `mcp_remove_server`'],
              ['メモリ', '`remember`, `recall`, `set_reminder`'],
              ['Agent', '`spawn_agent`（子 Run の作成）'],
            ]}
          />

          <H2>WebSocket イベント</H2>
          <Table
            headers={['イベント', '説明']}
            rows={[
              ['`started`', 'Run 開始'],
              ['`thinking`', 'LLM 推論中'],
              ['`tool_call`', 'ツール呼び出し'],
              ['`tool_result`', 'ツール結果'],
              ['`message`', 'Agent 応答'],
              ['`progress`', 'セッション操作の進行'],
              ['`completed`', '正常完了'],
              ['`error`', 'エラー'],
              ['`cancelled`', 'キャンセル済み'],
            ]}
          />

          <H2>制限値</H2>
          <Table
            headers={['項目', '値']}
            rows={[
              ['最大実行時間', '24 時間'],
              ['最大イテレーション数', '10,000'],
              ['最大ツール呼び出し', '1,000'],
              ['イテレーションタイムアウト', '2 分'],
              ['ツール実行タイムアウト', '5 分'],
              ['LLM 呼び出しタイムアウト', '2 分'],
              ['MCP ツールタイムアウト', '5 分'],
              ['最大 Skills 数', '20 / space'],
              ['子 Agent 深度', '3 レベル'],
            ]}
          />
        </div>
      }
      en={
        <div>
          <H2>Status Flow</H2>
          <CodeBlock>{`queued → running → completed
                 ↘ failed
                 ↘ cancelled`}</CodeBlock>
          <P>
            When a message is sent, a Run is created.
            Events are streamed in real-time via WebSocket during execution.
          </P>

          <H2>Thread / Run API</H2>
          <H3>Thread</H3>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/spaces/:spaceId/threads" desc="Create" />
            <Endpoint method="GET" path="/api/spaces/:spaceId/threads/:threadId" desc="Get" />
            <Endpoint method="POST" path="/api/threads/:threadId/messages" desc="Send message" />
          </div>

          <H3>Run</H3>
          <div className="space-y-0.5">
            <Endpoint method="POST" path="/api/threads/:threadId/runs" desc="Create" />
            <Endpoint method="GET" path="/api/runs/:runId" desc="Get" />
            <Endpoint method="POST" path="/api/runs/:runId/cancel" desc="Cancel" />
          </div>

          <H2>WebSocket Connection</H2>
          <CodeBlock>{`// Connect
const ws = new WebSocket("wss://takos.jp/api/runs/{runId}/ws");

// After connection, send subscribe message
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "subscribe", runId: "..." }));
};

// Receive events
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // event.type: "started" | "thinking" | "tool_call" | ...
  // event.data: event-specific payload
  // event.eventId: sequential ID
};

// Reconnect from a specific point
const ws = new WebSocket(
  "wss://takos.jp/api/runs/{runId}/ws?last_event_id=42"
);`}</CodeBlock>
          <P>Authentication uses the existing session cookie or Bearer token.</P>

          <H2>Built-in Tools</H2>
          <Table
            headers={['Category', 'Tools']}
            rows={[
              ['Container', '`container_start`, `container_status`, `container_commit`, `container_stop`'],
              ['Repository', '`create_repository`, `repo_list`, `repo_status`, `repo_switch`'],
              ['Files', '`file_read`, `file_write`, `file_list`, `file_delete`, `file_mkdir`, `file_rename`, `file_copy`'],
              ['Execution', '`runtime_exec`, `runtime_status`'],
              ['Search & Web', '`search`, `web_fetch`, `web_search`, `store_search`'],
              ['Workers', '`worker_list`, `worker_create`, `worker_delete`, `worker_env_set`'],
              ['Deploy', '`app_deployment_deploy_from_repo`, `app_deployment_list`, `app_deployment_rollback`'],
              ['MCP', '`mcp_add_server`, `mcp_list_servers`, `mcp_update_server`, `mcp_remove_server`'],
              ['Memory', '`remember`, `recall`, `set_reminder`'],
              ['Agent', '`spawn_agent` (create child run)'],
            ]}
          />

          <H2>WebSocket Events</H2>
          <Table
            headers={['Event', 'Description']}
            rows={[
              ['`started`', 'Run started'],
              ['`thinking`', 'LLM inference'],
              ['`tool_call`', 'Tool invocation'],
              ['`tool_result`', 'Tool result'],
              ['`message`', 'Agent response'],
              ['`progress`', 'Session operation progress'],
              ['`completed`', 'Completed successfully'],
              ['`error`', 'Error'],
              ['`cancelled`', 'Cancelled'],
            ]}
          />

          <H2>Limits</H2>
          <Table
            headers={['Setting', 'Value']}
            rows={[
              ['Max run time', '24 hours'],
              ['Max iterations', '10,000'],
              ['Max tool calls', '1,000'],
              ['Iteration timeout', '2 min'],
              ['Tool execution timeout', '5 min'],
              ['LLM call timeout', '2 min'],
              ['MCP tool timeout', '5 min'],
              ['Max skills', '20 per space'],
              ['Child agent depth', '3 levels'],
            ]}
          />
        </div>
      }
    />
  );
}

export default AiAgentSection;
