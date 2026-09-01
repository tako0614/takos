import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import {
  canonicalizeClientMessageAttachments,
  InvalidClientMessageAttachmentError,
} from "../message-attachment-authority.ts";

const STORAGE_DDL = `
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
  upload_state TEXT NOT NULL DEFAULT 'ready',
  upload_expires_at TEXT,
  uploaded_by_account_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

test("message attachment authority publishes only the canonical ready Thread file", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`${STORAGE_DDL}
      INSERT INTO account_storage_files
        (id, account_id, name, path, type, size, mime_type, r2_key)
      VALUES
        ('file_valid', 'space_1', 'photo.png',
         '/chat-attachments/thread_1/photo.png', 'file', 42, 'image/png',
         'storage/space_1/file_valid');
    `);
    const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;

    const attachments = await canonicalizeClientMessageAttachments(
      db,
      "space_1",
      "thread_1",
      [{
        file_id: "file_valid",
        name: "forged.svg",
        path: "/chat-attachments/thread_2/forged.svg",
        mime_type: "image/svg+xml",
        size: 1,
      }],
    );

    expect(attachments).toEqual([{
      file_id: "file_valid",
      name: "photo.png",
      path: "/chat-attachments/thread_1/photo.png",
      mime_type: "image/png",
      size: 42,
    }]);
  } finally {
    client.close();
  }
});

test("message attachment authority rejects cross-Thread, incomplete, and duplicate claims", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`${STORAGE_DDL}
      INSERT INTO account_storage_files
        (id, account_id, name, path, type, size, mime_type, r2_key, upload_state)
      VALUES
        ('file_other_thread', 'space_1', 'other.txt',
         '/chat-attachments/thread_2/other.txt', 'file', 1, 'text/plain',
         'storage/space_1/file_other_thread', 'ready'),
        ('file_pending', 'space_1', 'pending.txt',
         '/chat-attachments/thread_1/pending.txt', 'file', 1, 'text/plain',
         'storage/space_1/file_pending', 'pending'),
        ('file_without_object', 'space_1', 'missing.txt',
         '/chat-attachments/thread_1/missing.txt', 'file', 1, 'text/plain',
         NULL, 'ready');
    `);
    const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;
    const claim = (fileId: string) => ({ file_id: fileId, name: "claim.txt" });

    for (
      const fileId of [
        "file_other_thread",
        "file_pending",
        "file_without_object",
        "file_unknown",
      ]
    ) {
      await expect(
        canonicalizeClientMessageAttachments(
          db,
          "space_1",
          "thread_1",
          [claim(fileId)],
        ),
      ).rejects.toBeInstanceOf(InvalidClientMessageAttachmentError);
    }
    await expect(
      canonicalizeClientMessageAttachments(
        db,
        "space_1",
        "thread_1",
        [claim("file_other_thread"), claim("file_other_thread")],
      ),
    ).rejects.toBeInstanceOf(InvalidClientMessageAttachmentError);
  } finally {
    client.close();
  }
});
