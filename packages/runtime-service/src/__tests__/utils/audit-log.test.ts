import * as fs from "node:fs/promises";
import path from "node:path";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

type AuditLogModule = typeof import("../../utils/audit-log.ts");

async function freshWriteAuditLog(): Promise<AuditLogModule["writeAuditLog"]> {
  const url = new URL("../../utils/audit-log.ts", import.meta.url);
  url.searchParams.set("test", crypto.randomUUID());
  const mod = await import(url.href);
  return mod.writeAuditLog;
}

async function withAuditLogDir<T>(
  auditLogDir: string,
  fn: (writeAuditLog: AuditLogModule["writeAuditLog"]) => Promise<T>,
): Promise<T> {
  const original = Deno.env.get("TAKOS_AUDIT_LOG_DIR");
  Deno.env.set("TAKOS_AUDIT_LOG_DIR", auditLogDir);

  try {
    const writeAuditLog = await freshWriteAuditLog();
    return await fn(writeAuditLog);
  } finally {
    if (original === undefined) {
      Deno.env.delete("TAKOS_AUDIT_LOG_DIR");
    } else {
      Deno.env.set("TAKOS_AUDIT_LOG_DIR", original);
    }
  }
}

async function createTempAuditDir(): Promise<string> {
  return await Deno.makeTempDir();
}

Deno.test("writeAuditLog - writes audit entry as JSONL", async () => {
  const auditLogDir = await createTempAuditDir();

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        command: "echo hello",
        status: "completed",
      });

      const filePath = path.join(auditLogDir, "execution-audit.jsonl");
      const writtenLine = await fs.readFile(filePath, "utf8");
      assertEquals(writtenLine.endsWith("\n"), true);

      const parsed = JSON.parse(
        writtenLine.trim(),
      ) as { event?: string; spaceId?: string; command?: string };
      assertEquals(parsed.event, "exec");
      assertEquals(parsed.spaceId, "ws1");
      assertEquals(parsed.command, "echo hello");
    });
  } finally {
    await fs.rm(auditLogDir, { recursive: true, force: true });
  }
});

Deno.test("writeAuditLog - redacts credentials in URLs", async () => {
  const auditLogDir = await createTempAuditDir();

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        command: "git clone https://user:password@github.com/repo.git",
        status: "started",
      });

      const filePath = path.join(auditLogDir, "execution-audit.jsonl");
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as {
        command?: string;
      };
      assert(!(parsed.command ?? "").includes("password"));
      assertStringIncludes(parsed.command ?? "", "***@");
    });
  } finally {
    await fs.rm(auditLogDir, { recursive: true, force: true });
  }
});

Deno.test("writeAuditLog - redacts Authorization header values", async () => {
  const auditLogDir = await createTempAuditDir();

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        command:
          'curl -H "Authorization: Bearer my-secret-token" https://api.com',
        status: "started",
      });

      const filePath = path.join(auditLogDir, "execution-audit.jsonl");
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as {
        command?: string;
      };
      assert(!(parsed.command ?? "").includes("my-secret-token"));
      assertStringIncludes(parsed.command ?? "", "Authorization: ***");
    });
  } finally {
    await fs.rm(auditLogDir, { recursive: true, force: true });
  }
});

Deno.test("writeAuditLog - redacts SECRET_KEY=value patterns", async () => {
  const auditLogDir = await createTempAuditDir();

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        command: "SECRET_KEY=mysecret npm start",
        status: "started",
      });

      const filePath = path.join(auditLogDir, "execution-audit.jsonl");
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as {
        command?: string;
      };
      assert(!(parsed.command ?? "").includes("mysecret"));
      assertStringIncludes(parsed.command ?? "", "SECRET_KEY=***");
    });
  } finally {
    await fs.rm(auditLogDir, { recursive: true, force: true });
  }
});

Deno.test("writeAuditLog - redacts commands array", async () => {
  const auditLogDir = await createTempAuditDir();

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        commands: [
          'curl -H "Authorization: Bearer token1"',
          "echo TOKEN=secret123",
        ],
        status: "started",
      });

      const filePath = path.join(auditLogDir, "execution-audit.jsonl");
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as {
        commands?: string[];
      };
      assert(!(parsed.commands?.[0] ?? "").includes("token1"));
      assertStringIncludes(parsed.commands?.[1] ?? "", "TOKEN=***");
    });
  } finally {
    await fs.rm(auditLogDir, { recursive: true, force: true });
  }
});

Deno.test("writeAuditLog - does not throw on write failure", async () => {
  const tempRoot = await createTempAuditDir();
  const auditLogDir = path.join(tempRoot, "audit-log-file");
  await fs.writeFile(auditLogDir, "not a directory");

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        status: "started",
      });
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

Deno.test("writeAuditLog - ensures directory is created on first call", async () => {
  const auditLogDir = await createTempAuditDir();

  try {
    await withAuditLogDir(auditLogDir, async (writeAuditLog) => {
      await writeAuditLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "exec",
        spaceId: "ws1",
        status: "started",
      });

      const filePath = path.join(auditLogDir, "execution-audit.jsonl");
      const stat = await fs.stat(path.dirname(filePath));
      assert(stat.isDirectory());
      assertEquals((await fs.readFile(filePath, "utf8")).length > 0, true);
    });
  } finally {
    await fs.rm(auditLogDir, { recursive: true, force: true });
  }
});
