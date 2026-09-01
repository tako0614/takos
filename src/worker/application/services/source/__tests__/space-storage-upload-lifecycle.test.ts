import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { createInMemoryObjectStore } from "../../../../local-platform/in-memory-r2.ts";
import {
  confirmUpload,
  createFileRecord,
  createFileWithContent,
  runPendingStorageUploadGcBatch,
  uploadPendingFileContent,
} from "../space-storage.ts";

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
  upload_state TEXT NOT NULL DEFAULT 'ready'
    CHECK (upload_state IN ('pending', 'uploading', 'ready')),
  upload_expires_at TEXT,
  uploaded_by_account_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_account_storage_files_account_path
  ON account_storage_files(account_id, path);
CREATE INDEX idx_account_storage_files_upload_state_expires_at
  ON account_storage_files(upload_state, upload_expires_at);
`;

async function createTestStorage() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(STORAGE_DDL);
  const database = drizzle(client, { schema });
  return {
    client,
    db: database as unknown as SqlDatabaseBinding,
    bucket: createInMemoryObjectStore(),
  };
}

test("Storage upload URLs are expiring one-time transitions and cannot overwrite ready content", async () => {
  const { client, db, bucket } = await createTestStorage();
  try {
    const bytes = new TextEncoder().encode("first");
    const prepared = await createFileRecord(db, "space-1", "user-1", {
      name: "report.txt",
      parentPath: "/",
      size: bytes.byteLength,
      mimeType: "text/plain",
    });
    expect(Date.parse(prepared.expiresAt)).toBeGreaterThan(Date.now());

    const pending = await client.execute({
      sql: "SELECT upload_state, upload_expires_at FROM account_storage_files WHERE id = ?",
      args: [prepared.file.id],
    });
    expect(pending.rows[0]?.upload_state).toBe("pending");
    expect(pending.rows[0]?.upload_expires_at).toBe(prepared.expiresAt);

    await uploadPendingFileContent(
      db,
      bucket,
      "space-1",
      prepared.file.id,
      bytes.buffer,
      "text/plain",
    );

    const ready = await client.execute({
      sql: "SELECT upload_state, upload_expires_at FROM account_storage_files WHERE id = ?",
      args: [prepared.file.id],
    });
    expect(ready.rows[0]?.upload_state).toBe("ready");
    expect(ready.rows[0]?.upload_expires_at).toBeNull();
    expect(await (await bucket.get(prepared.r2Key))?.text()).toBe("first");

    const overwrite = new TextEncoder().encode("other");
    await expect(
      uploadPendingFileContent(
        db,
        bucket,
        "space-1",
        prepared.file.id,
        overwrite.buffer,
        "text/plain",
      ),
    ).rejects.toThrow("already complete");
    expect(await (await bucket.get(prepared.r2Key))?.text()).toBe("first");

    const confirmed = await confirmUpload(
      db,
      bucket,
      "space-1",
      prepared.file.id,
    );
    expect(confirmed?.size).toBe(bytes.byteLength);
  } finally {
    client.close();
  }
});

test("Storage upload rejects expired records before writing an object", async () => {
  const { client, db, bucket } = await createTestStorage();
  try {
    const bytes = new TextEncoder().encode("late");
    const prepared = await createFileRecord(db, "space-1", "user-1", {
      name: "late.txt",
      parentPath: "/",
      size: bytes.byteLength,
    });
    await client.execute({
      sql: "UPDATE account_storage_files SET upload_expires_at = ? WHERE id = ?",
      args: ["2000-01-01T00:00:00.000Z", prepared.file.id],
    });

    await expect(
      uploadPendingFileContent(
        db,
        bucket,
        "space-1",
        prepared.file.id,
        bytes.buffer,
      ),
    ).rejects.toThrow("expired");
    expect(await bucket.head(prepared.r2Key)).toBeNull();

    await expect(
      createFileRecord(db, "space-1", "user-1", {
        name: "unsafe.bin",
        parentPath: "/",
        size: 1,
        mimeType: "image/png\r\nX-Injected: yes",
      }),
    ).rejects.toThrow("Invalid Storage MIME type");
    await expect(
      createFileRecord(db, "space-1", "user-1", {
        name: " report.txt",
        parentPath: "/",
        size: 1,
      }),
    ).rejects.toThrow("Invalid file name");
  } finally {
    client.close();
  }
});

test("Storage upload accepts an empty file without confusing it with an orphan", async () => {
  const { client, db, bucket } = await createTestStorage();
  try {
    const prepared = await createFileRecord(db, "space-1", "user-1", {
      name: ".gitkeep",
      parentPath: "/",
      size: 0,
    });
    const uploaded = await uploadPendingFileContent(
      db,
      bucket,
      "space-1",
      prepared.file.id,
      new ArrayBuffer(0),
    );

    expect(uploaded.size).toBe(0);
    expect((await bucket.head(prepared.r2Key))?.size).toBe(0);
    const row = await client.execute({
      sql: "SELECT upload_state, upload_expires_at FROM account_storage_files WHERE id = ?",
      args: [prepared.file.id],
    });
    expect(row.rows[0]?.upload_state).toBe("ready");
    expect(row.rows[0]?.upload_expires_at).toBeNull();
  } finally {
    client.close();
  }
});

test("pending upload GC deletes missing records, recovers uploaded objects, and preserves ready empty files", async () => {
  const { client, db, bucket } = await createTestStorage();
  try {
    const missing = await createFileRecord(db, "space-1", "user-1", {
      name: "missing.bin",
      parentPath: "/",
      size: 4,
    });
    const recoverable = await createFileRecord(db, "space-1", "user-1", {
      name: "recoverable.bin",
      parentPath: "/",
      size: 7,
    });
    const recoverableBytes = new TextEncoder().encode("stored!");
    await bucket.put(recoverable.r2Key, recoverableBytes, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const empty = await createFileWithContent(
      db,
      bucket,
      "space-1",
      "user-1",
      "/empty.txt",
      "",
      "text/plain",
    );

    await client.execute({
      sql: "UPDATE account_storage_files SET upload_expires_at = ? WHERE id IN (?, ?)",
      args: [
        "2000-01-01T00:00:00.000Z",
        missing.file.id,
        recoverable.file.id,
      ],
    });

    expect(
      await runPendingStorageUploadGcBatch(db, bucket, {
        maxAgeMs: 0,
        maxRecords: 10,
      }),
    ).toEqual({
      scanned: 2,
      recovered: 1,
      deleted: 1,
      hasMore: false,
    });

    const rows = await client.execute({
      sql: "SELECT id, size, upload_state FROM account_storage_files ORDER BY path",
      args: [],
    });
    expect(rows.rows.map((row) => ({
      id: row.id,
      size: Number(row.size),
      state: row.upload_state,
    }))).toEqual([
      { id: empty.id, size: 0, state: "ready" },
      {
        id: recoverable.file.id,
        size: recoverableBytes.byteLength,
        state: "ready",
      },
    ]);
    expect(await bucket.head(missing.r2Key)).toBeNull();
    expect((await bucket.head(recoverable.r2Key))?.size).toBe(
      recoverableBytes.byteLength,
    );
  } finally {
    client.close();
  }
});
