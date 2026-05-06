#!/usr/bin/env -S deno run --config deno.json --allow-run=deno --allow-env

type GateStatus = 'passed' | 'failed' | 'skipped';

type GateCommand = {
  name: string;
  command: string[];
  env?: Record<string, string>;
};

type GateResult = {
  name: string;
  command: string[];
  status: GateStatus;
  code: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

const keepGoing = Deno.args.includes('--keep-going');
const unknownArgs = Deno.args.filter((arg) => arg !== '--keep-going');

if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  console.error(
    'Usage: deno run --config deno.json --allow-run=deno --allow-env scripts/release-gate.ts [--keep-going]',
  );
  Deno.exit(2);
}

const gates: GateCommand[] = [
  {
    name: 'check',
    command: ['deno', 'task', 'check'],
  },
  {
    name: 'validate-agent-docs',
    command: ['deno', 'task', 'validate:agent-docs'],
  },
  {
    name: 'validate-architecture',
    command: ['deno', 'task', 'validate:architecture'],
  },
  {
    name: 'docs:build',
    command: ['deno', 'task', 'docs:build'],
  },
  {
    name: 'service-set-validator',
    command: ['deno', 'task', 'validate:service-set'],
  },
  {
    name: 'validate-distributions',
    command: ['deno', 'task', 'validate:distributions'],
  },
  {
    name: 'validate-helm',
    command: ['deno', 'task', 'validate:helm'],
  },
  {
    name: 'helm-overlay-generator',
    command: ['deno', 'task', 'helm:check-overlays'],
  },
  {
    name: 'terraform-helm-values',
    command: ['deno', 'task', 'terraform:helm-values:check'],
  },
  {
    name: 'terraform-secret-policy',
    command: ['deno', 'task', 'validate:terraform-secrets'],
  },
  {
    name: 'release-manifest',
    command: [
      'deno',
      'run',
      '--config',
      'deno.json',
      '--allow-read',
      '--allow-run=git',
      'scripts/build-release-manifest.ts',
    ],
  },
  {
    name: 'local-config',
    command: ['deno', 'task', 'local:config'],
  },
];

const startedAt = new Date();
const results: GateResult[] = [];
let stoppedAfterFailure = false;

for (const gate of gates) {
  console.error(
    `release-gate: running ${gate.name}: ${shellCommand(gate.command)}`,
  );
  const result = await runGate(gate);
  results.push(result);

  if (result.status === 'failed' && !keepGoing) {
    stoppedAfterFailure = true;
    break;
  }
}

if (stoppedAfterFailure) {
  const completed = new Set(results.map((result) => result.name));
  for (const gate of gates) {
    if (completed.has(gate.name)) continue;
    results.push({
      name: gate.name,
      command: gate.command,
      status: 'skipped',
      code: null,
      durationMs: 0,
      stdout: '',
      stderr: 'skipped after earlier failure',
    });
  }
}

const failed = results.filter((result) => result.status === 'failed');
const finishedAt = new Date();
const summary = {
  ok: failed.length === 0,
  keepGoing,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  commandNames: results.map((result) => result.name),
  counts: {
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: failed.length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  },
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (failed.length > 0) {
  Deno.exit(1);
}

async function runGate(gate: GateCommand): Promise<GateResult> {
  const started = performance.now();
  const output = await new Deno.Command(gate.command[0], {
    args: gate.command.slice(1),
    stdout: 'piped',
    stderr: 'piped',
    env: gate.env,
  }).output();
  const durationMs = Math.round(performance.now() - started);
  const stdout = decode(output.stdout);
  const stderr = decode(output.stderr);

  if (stdout.length > 0) console.error(prefixLines(gate.name, stdout));
  if (stderr.length > 0) console.error(prefixLines(gate.name, stderr));
  console.error(
    `release-gate: ${gate.name} ${output.success ? 'passed' : 'failed'} in ${durationMs}ms`,
  );

  return {
    name: gate.name,
    command: gate.command,
    status: output.success ? 'passed' : 'failed',
    code: output.code,
    durationMs,
    stdout,
    stderr,
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trimEnd();
}

function prefixLines(name: string, text: string): string {
  return text.split(/\r?\n/).map((line) => `[${name}] ${line}`).join('\n');
}

function shellCommand(command: readonly string[]): string {
  return command.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
