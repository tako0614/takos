import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env, Thread } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { createInMemoryObjectStore } from "../../../../local-platform/in-memory-r2.ts";
import {
  confirmUpload,
  createFileRecord,
  createFolder,
  uploadPendingFileContent,
} from "../../../services/source/space-storage.ts";
import {
  createMessage,
  createThread,
} from "../../../services/threads/thread-service.ts";
import { buildConversationHistory } from "../../../services/agent/runner-history.ts";
import type { ToolContext } from "../../tool-definitions.ts";
import { chatAttachmentReadHandler } from "../chat-attachment.ts";

const TEST_DDL = `
CREATE TABLE account_storage_files (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  r2_key TEXT,
  sha256 TEXT,
  uploaded_by_account_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_account_storage_files_account_path
  ON account_storage_files(account_id, path);
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  title TEXT,
  locale TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT,
  key_points TEXT NOT NULL DEFAULT '[]',
  retrieval_index INTEGER NOT NULL DEFAULT -1,
  context_window INTEGER NOT NULL DEFAULT 50,
  next_message_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  r2_key TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  parent_run_id TEXT,
  input TEXT NOT NULL DEFAULT '{}'
);
`;

function toolContext(input: {
  db: SqlDatabaseBinding;
  env: Env;
  spaceId: string;
  threadId: string;
}): ToolContext {
  return {
    spaceId: input.spaceId,
    threadId: input.threadId,
    runId: "run-1",
    userId: "user-1",
    role: "editor",
    capabilities: [],
    env: input.env,
    db: input.db,
  };
}

test("chat attachment upload is rendered in history and readable only through its thread-scoped core tool", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(TEST_DDL);
    const database = drizzle(client, { schema });
    const db = database as unknown as SqlDatabaseBinding;
    const bucket = createInMemoryObjectStore();
    const env = { DB: db, GIT_OBJECTS: bucket } as Env;
    const spaceId = "space-1";
    const createdThread = await createThread(db, spaceId, {
      title: "Attachment test",
    });
    expect(createdThread).not.toBeNull();
    const thread = createdThread as Thread;

    await createFolder(db, spaceId, "user-1", {
      name: "chat-attachments",
      parentPath: "/",
    });
    await createFolder(db, spaceId, "user-1", {
      name: thread.id,
      parentPath: "/chat-attachments",
    });

    const content = "Takos-owned attachment content";
    const bytes = new TextEncoder().encode(content);
    const { file } = await createFileRecord(db, spaceId, "user-1", {
      name: "notes.txt",
      parentPath: `/chat-attachments/${thread.id}`,
      size: bytes.byteLength,
      mimeType: "text/plain",
    });
    await uploadPendingFileContent(
      db,
      bucket,
      spaceId,
      file.id,
      bytes.buffer,
      bytes.byteLength,
      "text/plain",
    );
    const confirmed = await confirmUpload(db, bucket, spaceId, file.id);
    expect(confirmed?.path).toBe(`/chat-attachments/${thread.id}/notes.txt`);

    await createMessage(env, db, thread, {
      role: "user",
      content: "Read the attachment",
      metadata: {
        attachments: [
          {
            file_id: file.id,
            path: confirmed?.path,
            name: confirmed?.name,
            mime_type: confirmed?.mime_type,
            size: confirmed?.size,
          },
        ],
      },
    });
    await client.execute({
      sql: "INSERT INTO runs (id, thread_id, account_id, input) VALUES (?, ?, ?, '{}')",
      args: ["run-1", thread.id, spaceId],
    });

    const history = await buildConversationHistory({
      db,
      env,
      threadId: thread.id,
      runId: "run-1",
      spaceId,
      aiModel: "gpt-5.5",
    });
    expect(history.at(-1)?.content).toContain("chat_attachment_read");
    expect(history.at(-1)?.content).toContain(`file_id: ${file.id}`);

    const output = JSON.parse(
      await chatAttachmentReadHandler(
        { file_id: file.id },
        toolContext({ db, env, spaceId, threadId: thread.id }),
      ),
    ) as { encoding: string; content: string; attachment: { path: string } };
    expect(output.encoding).toBe("utf-8");
    expect(output.content).toBe(content);
    expect(output.attachment.path).toBe(
      `/chat-attachments/${thread.id}/notes.txt`,
    );
  } finally {
    client.close();
  }
});

test("chat attachment tool rejects a generic workspace file even when message metadata names its file_id", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(TEST_DDL);
    const database = drizzle(client, { schema });
    const db = database as unknown as SqlDatabaseBinding;
    const bucket = createInMemoryObjectStore();
    const env = { DB: db, GIT_OBJECTS: bucket } as Env;
    const spaceId = "space-1";
    const thread = (await createThread(db, spaceId, {
      title: "Guard test",
    })) as Thread;
    await createFolder(db, spaceId, "user-1", {
      name: "documents",
      parentPath: "/",
    });
    const bytes = new TextEncoder().encode("not a chat attachment");
    const { file } = await createFileRecord(db, spaceId, "user-1", {
      name: "private.txt",
      parentPath: "/documents",
      size: bytes.byteLength,
      mimeType: "text/plain",
    });
    await uploadPendingFileContent(
      db,
      bucket,
      spaceId,
      file.id,
      bytes.buffer,
      bytes.byteLength,
      "text/plain",
    );
    await createMessage(env, db, thread, {
      role: "user",
      content: "malformed attachment metadata",
      metadata: {
        attachments: [{ file_id: file.id, name: file.name, path: file.path }],
      },
    });

    await expect(
      chatAttachmentReadHandler(
        { file_id: file.id },
        toolContext({ db, env, spaceId, threadId: thread.id }),
      ),
    ).rejects.toThrow("not a Takos chat attachment");
  } finally {
    client.close();
  }
});
