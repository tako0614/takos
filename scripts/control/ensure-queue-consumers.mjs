#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import process from "node:process";

const QUEUE_CONSUMERS = [
  {
    queueKey: "runs",
    batchSize: 1,
    batchTimeout: 1,
    messageRetries: 3,
    deadLetterQueueKey: "runs_dlq",
  },
  {
    queueKey: "runs_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "index_jobs",
    batchSize: 5,
    batchTimeout: 60,
    messageRetries: 2,
    deadLetterQueueKey: "index_jobs_dlq",
  },
  {
    queueKey: "index_jobs_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "workflow",
    batchSize: 1,
    batchTimeout: 1,
    messageRetries: 3,
    deadLetterQueueKey: "workflow_dlq",
  },
  {
    queueKey: "workflow_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "deployment",
    batchSize: 1,
    batchTimeout: 1,
    messageRetries: 3,
    deadLetterQueueKey: "deployment_dlq",
  },
  {
    queueKey: "deployment_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
];

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
const queues = requireObjectOutput(outputs, "queue_bindings");
const wranglerGlobalArgs = [
  ...(configOption.value ? ["--config", configOption.value] : []),
  ...(environment === "production" ? [] : ["--env", environment]),
];

for (const consumer of QUEUE_CONSUMERS) {
  const queueName = requireStringProperty(
    queues,
    consumer.queueKey,
    "queue_bindings",
  );
  if (
    await queueAlreadyHasConsumer(queueName, workerName, wranglerGlobalArgs)
  ) {
    console.log(
      `Queue ${queueName} already has Worker consumer ${workerName}; continuing.`,
    );
    continue;
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
      requireStringProperty(
        queues,
        consumer.deadLetterQueueKey,
        "queue_bindings",
      ),
    );
  }
  const result = spawnSync("bunx", addArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  emitCommandResult(result);
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (
    result.status !== 0 &&
    !/already has|already exists|duplicate|consumer .* exists/i.test(combined)
  ) {
    throw new Error(
      `Failed to add Queue consumer ${workerName} for ${queueName}: ${bounded(
        combined,
      )}`,
    );
  }
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

async function queueAlreadyHasConsumer(queueName, workerName, globalArgs) {
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
  const consumers = parseConsumerList(result.stdout ?? "");
  return consumers.some((consumer) =>
    consumerMatchesWorker(consumer, workerName),
  );
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
  if (!consumer || typeof consumer !== "object") return false;
  return [
    consumer.script_name,
    consumer.scriptName,
    consumer.script,
    consumer.worker,
    consumer.service,
    consumer.name,
  ].some((value) => value === workerName);
}

function requireObjectOutput(outputs, key) {
  const value = outputValue(outputs[key]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`tofu output "${key}" must be an object`);
  }
  return value;
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
