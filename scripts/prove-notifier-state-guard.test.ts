import { expect, test } from "bun:test";
import { join } from "node:path";

const deadlineMs = 90_000;
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

async function cleanOwnedProcessGroup(pid: number, rejectIfLive: boolean): Promise<string | undefined> {
  let live: boolean;
  try {
    live = signalGroup(pid, 0);
  } catch (error) {
    return `could not inspect owned native proof process group ${pid}: ${String(error)}`;
  }
  if (!live) return undefined;
  try {
    signalGroup(pid, "SIGKILL");
  } catch (error) {
    return `could not kill owned native proof process group ${pid}: ${String(error)}`;
  }
  const deadline = Date.now() + reapMs;
  while (Date.now() < deadline) {
    try {
      if (!signalGroup(pid, 0)) {
        return rejectIfLive
          ? `successful native proof left process group ${pid} running; it was terminated`
          : undefined;
      }
    } catch (error) {
      return `could not verify owned native proof group ${pid}: ${String(error)}`;
    }
    await Bun.sleep(25);
  }
  return `owned native proof process group ${pid} remained live after SIGKILL`;
}

test("native legacy-KV notifier guard preserves stored state and R2 through cold replacement", async () => {
  // Bun tests elsewhere mock miniflare at module scope. A child process gives
  // this proof the installed Miniflare/workerd binary and its own deadline.
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "prove-notifier-state-guard.ts")], {
    cwd: join(import.meta.dir, ".."),
    // Own a process group so an external deadline also reaps workerd if the
    // proof process cannot finish Miniflare.dispose() after SIGTERM.
    detached: true,
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
    // Bound the full process, stdout, and stderr lifecycle. A descendant with
    // inherited pipe FDs can keep text() pending even after child.exited.
    const [code, output, diagnostics] = await Promise.race([
      Promise.all([child.exited, stdout, stderr] as const),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            signalGroup(child.pid, "SIGTERM");
            reject(new Error(`native notifier proof exceeded ${deadlineMs}ms`));
          } catch (error) {
            reject(error);
          }
        }, deadlineMs);
      }),
    ]);
    expect(code, `${output}\n${diagnostics}`).toBe(0);
    const result = JSON.parse(output) as { runtime: string; observations: string[] };
    expect(result.runtime).toContain("native workerd / legacy KV DO / local R2");
    expect(result.observations).toHaveLength(14);
    for (const kind of ["run", "notification"] as const) {
      for (const label of ["future-v2", "null", "false", "zero", "empty-string", "malformed"] as const) {
        const observation = result.observations.find((item) => item.startsWith(`${kind}/${label}:`));
        expect(observation).toContain("rejected entrypoints, KV unchanged");
        if (kind === "run") expect(observation).toContain("R2 gzip unchanged");
      }
      const healthy = result.observations.find((item) => item.startsWith(`${kind}/historical-unversioned:`));
      expect(healthy).toContain("event 101 persisted as v1 and survived native eviction");
      if (kind === "run") expect(healthy).toContain("dedup and R2 retained");
    }
    successful = true;
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (timer) clearTimeout(timer);
    const groupIssue = await cleanOwnedProcessGroup(child.pid, successful);
    const reaped = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(reapMs).then(() => false),
    ]);
    const cleanupIssue = groupIssue ??
      (!reaped ? `native proof child ${child.pid} did not reap within ${reapMs}ms` : undefined);
    if (cleanupIssue) {
      failed = true;
      failure = new Error(cleanupIssue, { cause: failure });
    }
  }
  if (failed) throw failure;
}, deadlineMs + 5_000);
