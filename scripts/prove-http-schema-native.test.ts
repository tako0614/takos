import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { NativeHttpSchemaProofReport } from "./prove-http-schema-native.ts";

const root = join(import.meta.dir, "..");
const deadlineMs = 75_000;
const reapMs = 2_500;

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function cleanOwnedGroup(pid: number, successful: boolean): Promise<string | undefined> {
  try {
    if (!signalGroup(pid, 0)) return undefined;
    signalGroup(pid, "SIGKILL");
    const deadline = Date.now() + reapMs;
    while (Date.now() < deadline) {
      if (!signalGroup(pid, 0)) {
        return successful
          ? `successful native HTTP schema proof left process group ${pid} running`
          : undefined;
      }
      await Bun.sleep(25);
    }
    return `owned native HTTP schema proof group ${pid} remained live after SIGKILL`;
  } catch (error) {
    return `could not clean owned native HTTP schema proof group ${pid}: ${String(error)}`;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("native D1 production HTTP schema admission blocks on the fixture lease and serves discovery after release", async () => {
  const node = Bun.which("node");
  expect(node, "native HTTP schema proof requires the CI-pinned Node 26.1 controller").not.toBeNull();
  const nodeVersion = await Bun.$`${node!} --version`.text();
  expect(nodeVersion.trim().startsWith("v26.1.")).toBe(true);

  const base = join(root, "tmp/ga-native-http-schema-20261001");
  await mkdir(base, { recursive: true });
  const outputDirectory = join(base, randomUUID());
  const child = Bun.spawn([
    node!, "--experimental-strip-types", join(import.meta.dir, "prove-http-schema-native.ts"),
    "--bun", process.execPath, "--output-dir", outputDirectory,
  ], {
    cwd: root,
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let successful = false;
  let failed = false;
  let failure: unknown;
  try {
    const [code, output, diagnostics] = await Promise.race([
      Promise.all([child.exited, stdout, stderr] as const),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            signalGroup(child.pid, "SIGTERM");
            reject(new Error(`native HTTP schema proof exceeded ${deadlineMs}ms`));
          } catch (error) { reject(error); }
        }, deadlineMs);
      }),
    ]);
    expect(code, `${output}\n${diagnostics}\nisolated proof: ${outputDirectory}`).toBe(0);
    const report = JSON.parse(output) as NativeHttpSchemaProofReport;
    const topLevelKeys = ["status", "result", "outputDir", "elapsedMs", "requestUrl", "bindings", "runtime", "compatibility", "bundle", "migrations"];
    expect(Object.keys(report).sort()).toEqual(topLevelKeys.sort());
    expect(JSON.parse(await readFile(join(outputDirectory, "result.json"), "utf8"))).toEqual(report);
    const wranglerBytes = await readFile(join(root, "deploy/cloudflare/wrangler.toml"));
    const wrangler = Bun.TOML.parse(wranglerBytes.toString()) as {
      compatibility_date: string;
      compatibility_flags: string[];
    };
    expect(report.compatibility).toEqual({
      date: wrangler.compatibility_date,
      flags: wrangler.compatibility_flags,
      sourceSha256: createHash("sha256").update(wranglerBytes).digest("hex"),
    });
    expect(report.status).toBe("passed");
    expect(report.result).toBe("NATIVE_HTTP_SCHEMA_ADMISSION_OK");
    expect(report.requestUrl).toBe("https://admin.example.test/.well-known/takos");
    expect(report.bindings.required).toHaveLength(13);
    expect(report.bindings.forbiddenPresent).toEqual([]);
    expect(report.migrations.count).toBe(106);

    const admissions = report.migrations.admissions;
    expect(admissions.length).toBeGreaterThanOrEqual(3);
    expect(admissions.length).toBeLessThanOrEqual(4);
    const locked = admissions[0]!;
    expect(locked.phase).toBe("fixture-locked");
    for (const admission of admissions) {
      expect(admission.method).toBe("GET");
      expect(admission.url).toBe("https://admin.example.test/.well-known/takos");
    }
    expect(locked.httpStatus).toBe(503);
    expect(locked.retryAfter).toBe("5");
    expect(locked.body).toMatchObject({ error: { code: "SCHEMA_MIGRATION_PENDING", details: { state: "applying" } } });
    expect(locked.ledger).toEqual([]);
    expect(locked.lock?.status).toBe("applying");
    expect(locked.lock?.holder).toMatch(/^native-http-schema-fixture-/u);
    expect(report.migrations.fixtureLockAfterRequest).toEqual(report.migrations.fixtureLockBeforeRequest);
    expect(report.migrations.releasedFixtureLock).toMatchObject({ status: "pending", holder: null, lease_expires_at: null });

    const postRelease = admissions.filter(({ phase }) => phase === "post-release");
    expect(postRelease.length).toBeGreaterThanOrEqual(1);
    expect(postRelease.length).toBeLessThanOrEqual(2);
    let prior = locked.ledger;
    for (const [index, admission] of postRelease.entries()) {
      expect(admission.httpStatus === 200 || admission.httpStatus === 503).toBe(true);
      expect(admission.ledger.length).toBeGreaterThan(prior.length);
      expect(admission.ledger.slice(0, prior.length)).toEqual(prior);
      if (admission.httpStatus === 200) expect(admission.ledger).toHaveLength(106);
      if (admission.httpStatus === 503) {
        expect(index).toBe(0);
        expect(admission.retryAfter).toBe("5");
        expect(admission.body).toMatchObject({ error: { code: "SCHEMA_MIGRATION_PENDING", details: { state: "pending", applied: admission.ledger.length, total: 106 } } });
        expect(report.migrations.continuationWaitMs).toBeGreaterThanOrEqual(5_000);
      } else {
        expect(admission.body).toMatchObject({
          product: "takos",
          name: "Takos",
          issuer: "https://admin.example.test",
          apiBaseUrl: "https://admin.example.test",
        });
      }
      prior = admission.ledger;
    }
    const lastPostRelease = postRelease.at(-1);
    if (!lastPostRelease) throw new Error("native HTTP proof has no post-release admission");
    expect(lastPostRelease.httpStatus).toBe(200);
    expect(report.migrations.readyLedger).toEqual(lastPostRelease.ledger);
    expect(report.migrations.readyLedger).toHaveLength(106);
    for (const [index, row] of report.migrations.readyLedger.entries()) {
      const embedded = report.migrations.embedded[index]!;
      expect(row.name).toBe(embedded.name);
      expect(row.checksum).toBe(embedded.sha256);
      expect(Date.parse(row.applied_at)).not.toBeNaN();
    }
    expect(admissions.at(-1)?.phase).toBe("cached-ready");
    expect(admissions.at(-1)?.httpStatus).toBe(200);
    expect(report.migrations.cachedLedgerUnchanged).toBe(true);
    expect(admissions.at(-1)?.ledger).toEqual(report.migrations.readyLedger);
    expect(report.bundle.inputHashesAfterRun).toEqual(report.bundle.inputHashes);
    expect(report.runtime.sourceHashesAfter).toEqual(report.runtime.sourceHashesBefore);
    expect(report.runtime.workerdPathOverridePresent).toBe(false);
    const workerd = report.runtime.workerdSnapshot as { children?: Array<{ sha256?: string; version?: { status?: number; stdout?: string } }> };
    expect(workerd.children?.length).toBeGreaterThan(0);
    for (const child of workerd.children ?? []) {
      expect(child.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(child.version?.status).toBe(0);
      expect(child.version?.stdout).toMatch(/workerd/iu);
    }

    // Keep CI log records below GitHub's per-line truncation limit and make
    // report reassembly verifiable from ordered chunks.
    const serialized = JSON.stringify(report);
    const digest = sha256(serialized);
    const chunkSize = 4_096;
    const chunks = Math.ceil(serialized.length / chunkSize);
    for (let index = 0; index < chunks; index++) {
      console.log(JSON.stringify({ nativeHttpSchemaProofReportChunk: {
        sha256: digest, index, chunks,
        data: serialized.slice(index * chunkSize, (index + 1) * chunkSize),
      } }));
    }
    successful = true;
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (timer) clearTimeout(timer);
    const [groupIssue, reaped] = await Promise.all([
      cleanOwnedGroup(child.pid, successful),
      Promise.race([child.exited.then(() => true), Bun.sleep(reapMs).then(() => false)]),
    ]);
    const cleanupIssue = groupIssue ?? (!reaped ? `native HTTP schema controller ${child.pid} did not reap within ${reapMs}ms` : undefined);
    if (cleanupIssue) {
      failed = true;
      failure = new Error(cleanupIssue, { cause: failure });
    }
    if (!failed) await rm(outputDirectory, { recursive: true, force: true });
    else console.error(`native HTTP schema proof diagnostics retained: ${outputDirectory}`);
  }
  if (failed) throw failure;
}, deadlineMs + reapMs + 1_000);
