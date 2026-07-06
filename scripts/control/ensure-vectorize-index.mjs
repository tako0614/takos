#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import process from "node:process";

function usage() {
  console.error(`
Usage: bun scripts/control/ensure-vectorize-index.mjs <name> --dimensions <n> --metric <metric> [--account-id <id>]

Creates a Cloudflare Vectorize index and treats duplicate_name as success so
Takosumi post-apply release activation can be retried safely.
`);
  process.exit(1);
}

const [name, ...args] = process.argv.slice(2);
if (!name) usage();

function readOption(parts, option) {
  const index = parts.indexOf(option);
  if (index === -1) return { value: undefined, rest: parts };
  const value = parts[index + 1];
  if (!value || value.startsWith("--")) usage();
  return {
    value,
    rest: [...parts.slice(0, index), ...parts.slice(index + 2)],
  };
}

const accountIdOption = readOption(args, "--account-id");
const wranglerArgs = accountIdOption.rest;
const env = {
  ...process.env,
  ...(accountIdOption.value
    ? { CLOUDFLARE_ACCOUNT_ID: accountIdOption.value }
    : {}),
};

const apiBase =
  process.env.TAKOS_CLOUDFLARE_API_BASE_URL ??
  process.env.CLOUDFLARE_API_BASE_URL;
if (apiBase?.trim()) {
  await ensureVectorizeIndexViaApi({
    name,
    args: wranglerArgs,
    accountId: accountIdOption.value ?? env.CLOUDFLARE_ACCOUNT_ID,
    apiBase,
    apiToken: env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN,
    billingContext: billingContextFromEnv(env),
  });
  process.exit(0);
}

const result = spawnSync(
  "bunx",
  ["wrangler", "vectorize", "create", name, ...wranglerArgs],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status === 0 || combined.includes("vectorize.index.duplicate_name")) {
  if (combined.includes("vectorize.index.duplicate_name")) {
    console.log(`Vectorize index ${name} already exists; continuing.`);
  }
  const verify = spawnSync(
    "bunx",
    ["wrangler", "vectorize", "get", name, "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );
  if (verify.stdout) process.stdout.write(verify.stdout);
  if (verify.stderr) process.stderr.write(verify.stderr);
  process.exit(verify.status ?? 1);
}

process.exit(result.status ?? 1);

async function ensureVectorizeIndexViaApi({
  name,
  args,
  accountId,
  apiBase,
  apiToken,
  billingContext,
}) {
  if (!accountId?.trim()) {
    throw new Error("--account-id or CLOUDFLARE_ACCOUNT_ID is required");
  }
  if (!apiToken?.trim()) {
    throw new Error("CLOUDFLARE_API_TOKEN or CF_API_TOKEN is required");
  }
  const dimensions = readRequiredValue(args, "--dimensions");
  const metric = readRequiredValue(args, "--metric");
  const base = apiBase.replace(/\/+$/u, "");
  const url = `${base}/accounts/${encodeURIComponent(
    accountId.trim(),
  )}/vectorize/v2/indexes`;
  const body = {
    name,
    config: {
      dimensions: Number(dimensions),
      metric,
    },
  };
  const create = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken.trim()}`,
      "content-type": "application/json",
      ...billingContextHeaders(billingContext),
    },
    body: JSON.stringify(body),
  });
  const createPayload = await readJson(create);
  if (!create.ok && !isDuplicateVectorizeIndex(createPayload)) {
    throw new Error(
      `Vectorize index create failed: HTTP ${create.status} ${JSON.stringify(
        createPayload.errors ?? createPayload,
      )}`,
    );
  }
  if (isDuplicateVectorizeIndex(createPayload)) {
    console.log(`Vectorize index ${name} already exists; continuing.`);
  }

  const verify = await fetch(`${url}/${encodeURIComponent(name)}`, {
    headers: {
      authorization: `Bearer ${apiToken.trim()}`,
      accept: "application/json",
      ...billingContextHeaders(billingContext),
    },
  });
  const verifyPayload = await readJson(verify);
  if (!verify.ok) {
    throw new Error(
      `Vectorize index verify failed: HTTP ${verify.status} ${JSON.stringify(
        verifyPayload.errors ?? verifyPayload,
      )}`,
    );
  }
  console.log(JSON.stringify(verifyPayload));
}

function billingContextFromEnv(env) {
  const context = parseReleaseContext(env.TAKOSUMI_RELEASE_CONTEXT_JSON);
  const workspaceId =
    stringValue(context?.workspaceId) ??
    stringValue(context?.spaceId) ??
    stringValue(env.TAKOSUMI_WORKSPACE_ID) ??
    stringValue(env.TAKOSUMI_SPACE_ID);
  const installation =
    context && typeof context.installation === "object"
      ? context.installation
      : undefined;
  const installationId =
    stringValue(installation?.id) ??
    stringValue(context?.installationId) ??
    stringValue(env.TAKOSUMI_CAPSULE_ID) ??
    stringValue(env.TAKOSUMI_INSTALLATION_ID);
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(installationId ? { installationId } : {}),
  };
}

function parseReleaseContext(raw) {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function billingContextHeaders(context) {
  return {
    ...(context?.workspaceId
      ? { "x-takosumi-cloud-billing-workspace-id": context.workspaceId }
      : {}),
    ...(context?.installationId
      ? { "x-takosumi-cloud-billing-installation-id": context.installationId }
      : {}),
  };
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRequiredValue(parts, option) {
  const { value } = readOption(parts, option);
  if (!value?.trim()) usage();
  return value.trim();
}

async function readJson(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, errors: [{ message: text }] };
  }
}

function isDuplicateVectorizeIndex(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return errors.some((error) => {
    const message =
      typeof error?.message === "string" ? error.message : String(error ?? "");
    return /duplicate_name|already exists/i.test(message);
  });
}
