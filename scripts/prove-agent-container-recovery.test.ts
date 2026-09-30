import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OciRuntime, command, type Options } from "./prove-agent-container-recovery.ts";
import type { RecoveryInstance } from "./prove-agent-worker-recovery.ts";

const contexts: string[] = [];
const stateRoots: string[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await rm(context, { recursive: true, force: true });
  for (const root of stateRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

function ownStateRoot(runtime: OciRuntime): string {
  const root: unknown = Reflect.get(runtime, "stateRoot");
  expect(typeof root).toBe("string");
  expect((root as string).startsWith(join(tmpdir(), "takos-proof-runc-"))).toBe(true);
  stateRoots.push(root as string);
  return root as string;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(): Promise<{ context: string; options: Options }> {
  const context = await mkdtemp(join(tmpdir(), "takos-oci-runtime-test-"));
  contexts.push(context);
  const layout = join(context, "layout");
  await mkdir(join(layout, "blobs/sha256"), { recursive: true });
  const blob = async (content: object) => {
    const bytes = Buffer.from(JSON.stringify(content));
    const hash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(layout, "blobs/sha256", hash), bytes);
    return { mediaType: "", digest: `sha256:${hash}`, size: bytes.length };
  };
  const config = await blob({ os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: [] }, config: { User: "takos", WorkingDir: "/app", Cmd: ["/usr/local/bin/takos-agent"] } });
  config.mediaType = "application/vnd.oci.image.config.v1+json";
  const manifest = await blob({ schemaVersion: 2, config, layers: [] });
  manifest.mediaType = "application/vnd.oci.image.manifest.v1+json";
  await writeFile(join(layout, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  await writeFile(join(layout, "index.json"), JSON.stringify({ schemaVersion: 2, manifests: [{ ...manifest, annotations: { "org.opencontainers.image.ref.name": "test" } }] }));
  return { context, options: { layout, reference: "test", umoci: "/bin/true", runc: "/bin/false", sourceCommit: "a".repeat(40), root: context } };
}

async function fakeUnpack(bundle: string): Promise<void> {
  await mkdir(join(bundle, "rootfs/etc"), { recursive: true });
  await mkdir(join(bundle, "rootfs/app"), { recursive: true });
  await mkdir(join(bundle, "rootfs/usr/local/bin"), { recursive: true });
  await writeFile(join(bundle, "rootfs/etc/passwd"), "takos:x:10001:10001::/home/takos:/bin/sh\n");
  await writeFile(join(bundle, "rootfs/usr/local/bin/takos-agent"), "fake binary");
  await writeFile(join(bundle, "config.json"), JSON.stringify({
    process: { user: { uid: 10001, gid: 10001 }, args: ["/usr/local/bin/takos-agent"], cwd: "/app", terminal: true },
    mounts: [], linux: { namespaces: [{ type: "network" }, { type: "mount" }, { type: "pid" }] },
  }));
}

type FakeState = { pid: number; startTicks: string; state: string } | undefined;

async function delayedCreateHarness(mode: "dead" | "survivor" | "reused" | "zombie", pidSource: "file" | "state" = "file", listOutput: string | ((ownedId: string) => string) = "[]\n", expectedError?: string) {
  const { context, options } = await fixture();
  const createEntered = deferred();
  const releaseCreate = deferred();
  const calls: string[][] = [];
  let processState: FakeState = { pid: 43123, startTicks: "12345", state: "S" };
  let ownedId = "";
  let clock = 0;
  const runtime = new OciRuntime(options, {
    runCommand: async (argv) => {
      if (argv[0] === options.umoci) {
        await fakeUnpack(argv.at(-1)!);
        return { code: 0, output: "" };
      }
      const commandName = argv.find((part) => ["create", "start", "kill", "delete", "list", "state"].includes(part));
      calls.push(argv);
      if (commandName === "create") {
        ownedId = argv.at(-1)!;
        const pidFile = argv[argv.indexOf("--pid-file") + 1]!;
        if (pidSource === "file") await writeFile(pidFile, "43123\n");
        createEntered.resolve();
        await releaseCreate.promise;
        return { code: 0, output: "" };
      }
      if (commandName === "kill") {
        if (mode === "dead") processState = undefined;
        if (mode === "reused") processState = { pid: 43123, startTicks: "67890", state: "S" };
        if (mode === "zombie") processState = { pid: 43123, startTicks: "12345", state: "Z" };
        return { code: mode === "survivor" ? 1 : 0, output: mode === "survivor" ? "kill denied" : "" };
      }
      if (commandName === "delete") return { code: mode === "survivor" ? 1 : 0, output: mode === "survivor" ? "delete denied" : "" };
      if (commandName === "list") return { code: 0, output: typeof listOutput === "function" ? listOutput(ownedId) : listOutput };
      if (commandName === "state") return pidSource === "state"
        ? { code: 0, output: JSON.stringify({ id: argv.at(-1), pid: 43123 }) }
        : { code: 1, output: "not found" };
      throw new Error(`unexpected runc call: ${argv.join(" ")}`);
    },
    readPid: async () => processState,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  await runtime.prepare(context);
  ownStateRoot(runtime);
  let instance: RecoveryInstance | undefined;
  const launch = runtime.launch(49123, "token", (value) => { instance = value; }, () => false);
  await createEntered.promise;
  expect(instance).toBeDefined();
  const stopped = instance!.stop();
  releaseCreate.resolve();
  await expect(launch).rejects.toThrow(expectedError ?? (mode === "survivor" ? "runc delete failed" : mode === "zombie" ? "zombie" : "cancelled after create"));
  return { runtime, stopped, calls };
}

test("abort during delayed create never starts init and cleans only its owned ID", async () => {
  const { runtime, stopped, calls } = await delayedCreateHarness("dead");
  expect(await stopped).toBe(0);
  const verbs = calls.map((argv) => argv.find((part) => ["create", "start", "kill", "delete", "list"].includes(part)));
  expect(verbs).toEqual(["create", "kill", "delete", "list"]);
  const id = calls[0]!.at(-1)!;
  expect(id).toMatch(/^takos-proof-[a-f0-9-]+$/u);
  expect(calls[1]).toContain(id);
  expect(calls[2]).toContain(id);
  expect(runtime.evidence().terminated).toEqual([{ id, initPid: 43123, initStartTicks: "12345", initAbsentAtCapture: false, initStatus: "absent", stateAbsent: true }]);
  await runtime.cleanup();
});

test("cleanup rejects a surviving init and failed kill/delete", async () => {
  const { runtime, stopped } = await delayedCreateHarness("survivor");
  await expect(stopped).rejects.toThrow("OCI init PID 43123 remains or its identity is unknown (live)");
  await expect(runtime.cleanup()).rejects.toThrow("runc delete failed");
});

test("cancelled create recovers init PID from runc state when pid-file is absent", async () => {
  const { runtime, stopped, calls } = await delayedCreateHarness("dead", "state");
  expect(await stopped).toBe(0);
  expect(calls.some((argv) => argv.includes("state"))).toBe(true);
  expect((runtime.evidence().terminated as { initPid: number }[])[0]?.initPid).toBe(43123);
  await runtime.cleanup();
});

test("runc 1.4 null empty list still proves owned ID absence", async () => {
  const { runtime, stopped } = await delayedCreateHarness("dead", "file", "null\n");
  expect(await stopped).toBe(0);
  expect((runtime.evidence().terminated as { stateAbsent: boolean }[])[0]?.stateAbsent).toBe(true);
  await runtime.cleanup();
});

test("list with another ID permits cleanup of only the owned ID", async () => {
  const { runtime, stopped, calls } = await delayedCreateHarness("dead", "file", '[{"id":"unrelated"}]');
  expect(await stopped).toBe(0);
  expect(calls.some((argv) => argv.includes("list"))).toBe(true);
  await runtime.cleanup();
});

test("list containing the owned ID refuses cleanup even with a dead init", async () => {
  const { runtime, stopped } = await delayedCreateHarness("dead", "file", (id) => JSON.stringify([{ id }]), "owned runc ID");
  await expect(stopped).rejects.toThrow("owned runc ID");
  await expect(runtime.cleanup()).rejects.toThrow("owned runc ID");
});

test("malformed object from runc list never proves state absence", async () => {
  const { runtime, stopped } = await delayedCreateHarness("dead", "file", '{"id":"some-container"}', "runc list did not return an array or null");
  await expect(stopped).rejects.toThrow("runc list did not return an array or null");
  await expect(runtime.cleanup()).rejects.toThrow("runc list did not return an array or null");
});

test("PID reuse is distinguished from the original init", async () => {
  const mode = "reused";
  const { runtime, stopped } = await delayedCreateHarness(mode);
  expect(await stopped).toBe(0);
  expect((runtime.evidence().terminated as { initStatus: string }[])[0]?.initStatus).toBe("reused");
  await runtime.cleanup();
});

test("a zombie is reported as unreaped, never mistaken for a live or absent init", async () => {
  const { runtime, stopped } = await delayedCreateHarness("zombie");
  await expect(stopped).rejects.toThrow("OCI init PID 43123 remains or its identity is unknown (zombie)");
  await expect(runtime.cleanup()).rejects.toThrow("zombie");
});

test("cleanup waits for in-flight unpack and prevents subsequent runc work", async () => {
  const { context, options } = await fixture();
  const unpackEntered = deferred();
  const releaseUnpack = deferred();
  const calls: string[][] = [];
  const runtime = new OciRuntime(options, {
    runCommand: async (argv) => {
      calls.push(argv);
      unpackEntered.resolve();
      await releaseUnpack.promise;
      await fakeUnpack(argv.at(-1)!);
      return { code: 0, output: "" };
    },
    readPid: async () => undefined, sleep: async () => undefined, now: Date.now,
  });
  const preparing = runtime.prepare(context);
  await unpackEntered.promise;
  const ownRoot = ownStateRoot(runtime);
  const cleaning = runtime.cleanup();
  releaseUnpack.resolve();
  await expect(preparing).rejects.toThrow("cleanup began during unpack");
  await cleaning;
  expect(calls).toHaveLength(1);
  await expect(stat(ownRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

test("changed unpacked executable is refused before runc create", async () => {
  const { context, options } = await fixture();
  const calls: string[][] = [];
  const runtime = new OciRuntime(options, {
    runCommand: async (argv) => {
      calls.push(argv);
      if (argv[0] !== options.umoci) throw new Error("runc must not run");
      await fakeUnpack(argv.at(-1)!);
      return { code: 0, output: "" };
    },
    readPid: async () => undefined, sleep: async () => undefined, now: Date.now,
  });
  await runtime.prepare(context);
  ownStateRoot(runtime);
  await writeFile(join(context, "oci-bundle/rootfs/usr/local/bin/takos-agent"), "changed binary");
  await expect(runtime.launch(49123, "token", () => undefined, () => false)).rejects.toThrow("unpacked executable changed");
  await runtime.cleanup();
  expect(calls).toHaveLength(1);
});

test("runc control output waits for EOF after delayed JSON", async () => {
  const result = await command(["/bin/sh", "-c", "(sleep 0.08; printf '[{\"id\":\"owned\"}]') &"], "delayed runc list");
  expect(JSON.parse(result.output)).toEqual([{ id: "owned" }]);
});

test("runc control JSON uses stdout even when stderr has a warning", async () => {
  const result = await command(["/bin/sh", "-c", "printf '[{\"id\":\"owned\"}]'; printf 'warning\\n' >&2"], "runc list with warning");
  expect(JSON.parse(result.output)).toEqual([{ id: "owned" }]);
  expect(result.stderr).toContain("warning");
});
