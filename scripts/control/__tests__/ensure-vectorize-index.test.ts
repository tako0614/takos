import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");

test("ensure-vectorize-index delegates to Wrangler with Cloudflare-native env", async () => {
  const dir = mkdtempSync(join(tmpdir(), "takos-vectorize-test-"));
  const bin = join(dir, "bin");
  const captureFile = join(dir, "calls.json");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "bunx"),
    `#!/usr/bin/env bash
node - "$BUNX_CAPTURE_FILE" "$@" <<'NODE'
const fs = require("node:fs");
const [file, ...args] = process.argv.slice(2);
const calls = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : [];
calls.push({
  args,
  env: {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_BASE_URL: process.env.CLOUDFLARE_API_BASE_URL,
    CF_API_BASE_URL: process.env.CF_API_BASE_URL,
    CLOUDFLARE_BASE_URL: process.env.CLOUDFLARE_BASE_URL,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  },
});
fs.writeFileSync(file, JSON.stringify(calls));
NODE
echo '{"success":true}'
`,
  );
  chmodSync(join(bin, "bunx"), 0o755);

  try {
    const proc = Bun.spawn(
      [
        "bun",
        "scripts/control/ensure-vectorize-index.mjs",
        "takos-test-embeddings",
        "--dimensions",
        "768",
        "--metric",
        "cosine",
        "--account-id",
        "ts_acc_takosumi_cloud",
      ],
      {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          BUNX_CAPTURE_FILE: captureFile,
          TAKOS_CLOUDFLARE_API_BASE_URL:
            "https://app.takosumi.com/compat/cloudflare/client/v4",
          CLOUDFLARE_API_TOKEN: "test-token",
        },
      },
    );
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    assert.equal(status, 0, `${stdout}\n${stderr}`.trim());
    const calls = JSON.parse(readFileSync(captureFile, "utf8"));
    assert.deepEqual(
      calls.map((call: { args: readonly string[] }) => call.args),
      [
        [
          "wrangler",
          "vectorize",
          "create",
          "takos-test-embeddings",
          "--dimensions",
          "768",
          "--metric",
          "cosine",
        ],
        ["wrangler", "vectorize", "get", "takos-test-embeddings", "--json"],
      ],
    );
    for (const call of calls) {
      assert.deepEqual(call.env, {
        CLOUDFLARE_ACCOUNT_ID: "ts_acc_takosumi_cloud",
        CLOUDFLARE_API_BASE_URL:
          "https://app.takosumi.com/compat/cloudflare/client/v4",
        CF_API_BASE_URL: "https://app.takosumi.com/compat/cloudflare/client/v4",
        CLOUDFLARE_BASE_URL:
          "https://app.takosumi.com/compat/cloudflare/client/v4",
        CLOUDFLARE_API_TOKEN: "test-token",
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
