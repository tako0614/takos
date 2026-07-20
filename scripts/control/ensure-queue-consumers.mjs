#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import process from "node:process";
import { QUEUE_CONSUMERS } from "./queue-consumer-config.ts";

// The Workers API may accept an upload before the Queues API can resolve the
// same Worker. Each Cloudflare API request is bounded independently, so retry the
// idempotent consumer declaration across that propagation window.
const WORKER_PROPAGATION_RETRY_DELAYS_MS = [0, 15_000, 30_000];

function usage() {
  console.error(`
Usage: bun scripts/control/ensure-queue-consumers.mjs <environment> [--config <path>]

Reads TAKOSUMI_OUTPUTS_JSON, then ensures the Takos Worker is registered as
the consumer for every queue binding. Wrangler deploy intentionally skips queue
consumer trigger reconciliation so a retry does not fail after the Worker and
assets were already uploaded.
`);
  process.exit(1);
}

const [environment, ...args] = process.argv.slice(2);
if (!environment) usage();

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

const configOption = readOption(args, "--config");
if (configOption.rest.length > 0) usage();

const outputs = readReleaseOutputs();
const workerName = requireStringOutput(outputs, "service_runtime_name");
const queues = requireObjectOutput(outputs, "queues");
const wranglerGlobalArgs = [
  ...(configOption.value ? ["--config", configOption.value] : []),
  ...(environment === "production" ? [] : ["--env", environment]),
];

for (const consumer of QUEUE_CONSUMERS) {
  const queueName = requireStringProperty(queues, consumer.queueKey, "queues");
  const currentConsumers = await listQueueConsumers(
    queueName,
    wranglerGlobalArgs,
  );
  const currentWorkerConsumer = currentConsumers.find((entry) =>
    consumerMatchesWorker(entry, workerName),
  );
  if (
    currentWorkerConsumer &&
    consumerSettingsMatch(currentWorkerConsumer, consumer, queues)
  ) {
    console.log(
      `Queue ${queueName} already has the desired Worker consumer ${workerName}; continuing.`,
    );
    continue;
  }

  if (currentWorkerConsumer) {
    console.log(
      `Queue ${queueName} Worker consumer ${workerName} settings drifted; replacing it.`,
    );
  }

  for (const current of currentConsumers) {
    const currentWorker = consumerWorkerName(current);
    if (!currentWorker || !isWorkerConsumer(current)) {
      throw new Error(
        `Queue ${queueName} has an unsupported existing consumer; refusing to replace it without a Worker script name`,
      );
    }
    await removeQueueConsumer(queueName, currentWorker, wranglerGlobalArgs);
  }

  const addArgs = [
    "wrangler",
    "queues",
    "consumer",
    "add",
    queueName,
    workerName,
    "--batch-size",
    String(consumer.batchSize),
    "--batch-timeout",
    String(consumer.batchTimeout),
    ...wranglerGlobalArgs,
  ];
  if (consumer.messageRetries != null) {
    addArgs.push("--message-retries", String(consumer.messageRetries));
  }
  if (consumer.deadLetterQueueKey) {
    addArgs.push(
      "--dead-letter-queue",
      requireStringProperty(queues, consumer.deadLetterQueueKey, "queues"),
    );
  }
  if (consumer.maxConcurrency != null) {
    addArgs.push("--max-concurrency", String(consumer.maxConcurrency));
  }
  if (consumer.retryDelaySeconds != null) {
    addArgs.push("--retry-delay-secs", String(consumer.retryDelaySeconds));
  }
  await addQueueConsumerWithRetry(
    addArgs,
    workerName,
    queueName,
    wranglerGlobalArgs,
    consumer,
    queues,
  );
}

async function addQueueConsumerWithRetry(
  addArgs,
  workerName,
  queueName,
  globalArgs,
  desired,
  queues,
) {
  for (let attempt = 0; ; attempt += 1) {
    const result = spawnSync("bunx", addArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    emitCommandResult(result);
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0) {
      return;
    }
    if (
      /already has|already exists|duplicate|consumer .* exists/i.test(combined)
    ) {
      const consumers = await listQueueConsumers(queueName, globalArgs);
      const matching = consumers.find((entry) =>
        consumerMatchesWorker(entry, workerName),
      );
      if (matching && consumerSettingsMatch(matching, desired, queues)) {
        return;
      }
      if (matching) {
        const duplicateDelay = WORKER_PROPAGATION_RETRY_DELAYS_MS[attempt];
        if (duplicateDelay === undefined) {
          throw new Error(
            `Queue ${queueName} still exposes stale settings for Worker consumer ${workerName} after replacement`,
          );
        }
        console.log(
          `Queue ${queueName} still exposes the stale Worker consumer ${workerName}; waiting for replacement propagation.`,
        );
        if (duplicateDelay > 0) await sleep(duplicateDelay);
        continue;
      }
    }
    const delay = WORKER_PROPAGATION_RETRY_DELAYS_MS[attempt];
    if (
      delay === undefined ||
      !queueConsumerWorkerPropagationPending(combined)
    ) {
      throw new Error(
        `Failed to add Queue consumer ${workerName} for ${queueName}: ${bounded(
          combined,
        )}`,
      );
    }
    console.log(
      `Queue consumer Worker ${workerName} is still propagating; retrying ${queueName}.`,
    );
    if (delay > 0) await sleep(delay);
  }
}

async function removeQueueConsumer(queueName, workerName, globalArgs) {
  const result = spawnSync(
    "bunx",
    [
      "wrangler",
      "queues",
      "consumer",
      "remove",
      queueName,
      workerName,
      ...globalArgs,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  emitCommandResult(result);
  if (result.status === 0) return;

  const remaining = await listQueueConsumers(queueName, globalArgs);
  if (!remaining.some((entry) => consumerMatchesWorker(entry, workerName))) {
    return;
  }
  throw new Error(
    `Failed to remove stale Queue consumer ${workerName} from ${queueName}: ${bounded(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )}`,
  );
}

function queueConsumerWorkerPropagationPending(output) {
  return (
    /worker.*does not exist/i.test(output) &&
    /(?:code:\s*10007|\b10007\b)/i.test(output)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readReleaseOutputs() {
  const raw = process.env.TAKOSUMI_OUTPUTS_JSON;
  if (!raw?.trim()) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON is required");
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `TAKOSUMI_OUTPUTS_JSON must be a JSON object: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function listQueueConsumers(queueName, globalArgs) {
  const result = spawnSync(
    "bunx",
    [
      "wrangler",
      "queues",
      "consumer",
      "list",
      queueName,
      "--json",
      ...globalArgs,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  if (result.status !== 0) {
    emitCommandResult(result);
    throw new Error(
      `Failed to list Queue consumers for ${queueName}: ${bounded(
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      )}`,
    );
  }
  return parseConsumerList(result.stdout ?? "");
}

function parseConsumerList(stdout) {
  const parsed = parseJsonFromCommandOutput(stdout);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.result)) return parsed.result;
  if (Array.isArray(parsed?.consumers)) return parsed.consumers;
  return [];
}

function parseJsonFromCommandOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/u);
  let lastError;
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = lines.slice(index).join("\n").trim();
    if (!candidate.startsWith("[") && !candidate.startsWith("{")) continue;
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Wrangler queue consumer list returned invalid JSON: ${
      lastError instanceof Error ? lastError.message : "no JSON payload found"
    }`,
  );
}

function consumerMatchesWorker(consumer, workerName) {
  return consumerWorkerName(consumer) === workerName;
}

function consumerSettingsMatch(current, desired, queues) {
  const settings =
    current?.settings && typeof current.settings === "object"
      ? current.settings
      : current;
  const expectedDeadLetterQueue = desired.deadLetterQueueKey
    ? requireStringProperty(queues, desired.deadLetterQueueKey, "queues")
    : "";
  const currentDeadLetterQueue =
    stringValue(current?.dead_letter_queue) ??
    stringValue(current?.deadLetterQueue) ??
    "";

  return (
    currentDeadLetterQueue === expectedDeadLetterQueue &&
    numberValue(settings?.batch_size, settings?.batchSize) ===
      desired.batchSize &&
    numberValue(settings?.max_wait_time_ms, settings?.maxWaitTimeMs) ===
      desired.batchTimeout * 1000 &&
    numberValue(settings?.max_retries, settings?.maxRetries, 3) ===
      (desired.messageRetries ?? 3) &&
    numberValue(settings?.retry_delay, settings?.retryDelay, 0) ===
      (desired.retryDelaySeconds ?? 0) &&
    nullableNumberValue(settings?.max_concurrency, settings?.maxConcurrency) ===
      (desired.maxConcurrency ?? null)
  );
}

function stringValue(value) {
  return typeof value === "string" ? value : null;
}

function numberValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function nullableNumberValue(...values) {
  if (values.some((value) => value === null || value === undefined)) {
    const numeric = numberValue(...values);
    return numeric ?? null;
  }
  return numberValue(...values);
}

function consumerWorkerName(consumer) {
  if (!consumer || typeof consumer !== "object") return false;
  return (
    [
      consumer.script_name,
      consumer.scriptName,
      consumer.script,
      consumer.worker,
      consumer.service,
      consumer.name,
    ].find((value) => typeof value === "string" && value.trim() !== "") ?? null
  );
}

function isWorkerConsumer(consumer) {
  if (!consumer || typeof consumer !== "object") return false;
  return !consumer.type || consumer.type === "worker";
}

function requireObjectOutput(outputs, key) {
  const value = outputValue(outputs[key]);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  throw new Error(`tofu output "${key}" must be an object`);
}

function requireStringOutput(outputs, key) {
  const value = outputValue(outputs[key]);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`tofu output "${key}" must be a non-empty string`);
  }
  return value.trim();
}

function requireStringProperty(object, key, outputName) {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`tofu output "${outputName}" has no "${key}" string`);
  }
  return value.trim();
}

function outputValue(entry) {
  if (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    Object.prototype.hasOwnProperty.call(entry, "value")
  ) {
    return entry.value;
  }
  return entry;
}

function emitCommandResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function bounded(text) {
  const trimmed = text.trim();
  if (trimmed.length <= 2000) return trimmed;
  return `${trimmed.slice(0, 500)}\n...\n${trimmed.slice(-1500)}`;
}
