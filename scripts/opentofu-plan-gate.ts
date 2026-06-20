#!/usr/bin/env -S bun
import * as runtime from "./runtime.ts";

type TargetId = 'cloudflare';

type Args = {
  outDir: string;
  targets: TargetId[];
  opentofuBin: string;
};

type CommandOutput = {
  code: number;
  stdout: string;
  stderr: string;
};

const CLOUDFLARE_PLAN_PLACEHOLDER_TOKEN = 'dummy-cloudflare-token-for-offline-plan';

type PlanResult = {
  target: TargetId;
  label: string;
  varFile: string;
  planFile: string;
  textFile: string;
  exitCode: number;
  add: number;
  change: number;
  destroy: number;
  hasChanges: boolean;
};

const planCases: Record<TargetId, { label: string; varFile: string }> = {
  cloudflare: {
    label: 'cloudflare-staging',
    varFile: 'plan/cloudflare-staging.tfvars',
  },
};

const args = parseArgs(runtime.args);
const root = runtime.cwd();
const opentofuRoot = `${root}/deploy/opentofu`;
const outDir = args.outDir;
const tfDataDir = `${root}/${outDir}/tfdata`;

await runtime.mkdir(outDir, { recursive: true });
await runRequired({
  name: 'tofu init',
  args: ['init', '-backend=false'],
  logStdout: true,
});

const results: PlanResult[] = [];
for (const target of args.targets) {
  results.push(await runPlan(target));
}

await runtime.writeTextFile(`${outDir}/summary.md`, renderMarkdownSummary(results));
console.log(JSON.stringify({ ok: true, outDir, results }, null, 2));

async function runPlan(target: TargetId): Promise<PlanResult> {
  const planCase = planCases[target];
  const planFile = `${root}/${outDir}/${planCase.label}.tfplan`;
  const textFile = `${root}/${outDir}/${planCase.label}.txt`;
  const output = await opentofu({
    name: `${planCase.label} tofu plan`,
    args: [
      'plan',
      '-no-color',
      '-refresh=false',
      '-lock=false',
      '-input=false',
      '-detailed-exitcode',
      `-var-file=${planCase.varFile}`,
      `-out=${planFile}`,
    ],
    logStdout: false,
  });

  if (output.code !== 0 && output.code !== 2) {
    await runtime.writeTextFile(textFile, joinOutput(output));
    throw new Error(`${planCase.label} tofu plan failed with exit code ${output.code}. See ${textFile}`);
  }

  const show = await runRequired({
    name: `${planCase.label} tofu show`,
    args: ['show', '-no-color', planFile],
    logStdout: false,
  });
  await runtime.writeTextFile(textFile, show.stdout);

  const counts = parsePlanCounts(show.stdout);
  console.error(
    `opentofu-plan-gate: ${planCase.label}: ${counts.add} add, ${counts.change} change, ${counts.destroy} destroy; wrote ${
      relativeToRoot(textFile)
    }`,
  );
  return {
    target,
    label: planCase.label,
    varFile: planCase.varFile,
    planFile: relativeToRoot(planFile),
    textFile: relativeToRoot(textFile),
    exitCode: output.code,
    ...counts,
    hasChanges: output.code === 2,
  };
}

type OpenTofuCommand = {
  name: string;
  args: string[];
  logStdout?: boolean;
};

async function runRequired(input: OpenTofuCommand): Promise<CommandOutput> {
  const output = await opentofu(input);
  if (output.code !== 0) {
    throw new Error(`${input.name} failed with exit code ${output.code}:\n${joinOutput(output)}`);
  }
  return output;
}

async function opentofu(input: OpenTofuCommand): Promise<CommandOutput> {
  console.error(`opentofu-plan-gate: ${input.name}: ${[args.opentofuBin, ...input.args].join(' ')}`);
  const output = await runtime.runCommand(args.opentofuBin, {
    args: input.args,
    cwd: opentofuRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      TF_DATA_DIR: tfDataDir,
      CLOUDFLARE_API_TOKEN: CLOUDFLARE_PLAN_PLACEHOLDER_TOKEN,
    },
  });

  const decoded = {
    code: output.code,
    stdout: decode(output.stdout),
    stderr: decode(output.stderr),
  };
  if (input.logStdout !== false && decoded.stdout.trim().length > 0) {
    console.error(prefixLines(input.name, decoded.stdout));
  }
  if (decoded.stderr.trim().length > 0) console.error(prefixLines(input.name, decoded.stderr));
  return decoded;
}

function parsePlanCounts(text: string): { add: number; change: number; destroy: number } {
  const match = text.match(/Plan:\s+(\d+) to add,\s+(\d+) to change,\s+(\d+) to destroy\./);
  if (!match) {
    if (text.includes('No changes.')) {
      return { add: 0, change: 0, destroy: 0 };
    }
    throw new Error('Unable to find OpenTofu plan summary counts');
  }
  return {
    add: Number(match[1]),
    change: Number(match[2]),
    destroy: Number(match[3]),
  };
}

function renderMarkdownSummary(results: PlanResult[]): string {
  const lines = [
    '# OpenTofu Plan Gate',
    '',
    'Staging plans are generated from `deploy/opentofu` root composition with `opentofu_plan_mode = true` and a temporary CI-only Cloudflare token env placeholder.',
    'Full plan text is uploaded as workflow artifact.',
    '',
    '| Target | Var file | Add | Change | Destroy | Plan text |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];

  for (const result of results) {
    lines.push(
      `| ${result.label} | \`${result.varFile}\` | ${result.add} | ${result.change} | ${result.destroy} | \`${result.textFile}\` |`,
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function joinOutput(output: CommandOutput): string {
  return [output.stdout, output.stderr].filter((part) => part.trim().length > 0).join('\n');
}

function prefixLines(name: string, text: string): string {
  return text.trimEnd().split(/\r?\n/).map((line) => `[${name}] ${line}`).join('\n');
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function relativeToRoot(path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function parseArgs(values: readonly string[]): Args {
  const parsed: Args = {
    outDir: '.opentofu-plan',
    targets: ['cloudflare'],
    opentofuBin: runtime.env.get('TAKOS_OPENTOFU_BIN') ?? 'tofu',
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    switch (value) {
      case '--':
        break;
      case '--out-dir':
        parsed.outDir = requiredArgValue(values, index, value);
        index += 1;
        break;
      case '--target': {
        const target = requiredArgValue(values, index, value);
        if (target !== 'cloudflare') {
          console.error(`--target must be cloudflare, got ${target}`);
          runtime.exit(2);
        }
        parsed.targets = [target];
        index += 1;
        break;
      }
      case '--opentofu-bin':
        parsed.opentofuBin = requiredArgValue(values, index, value);
        index += 1;
        break;
      case '--help':
      case '-h':
        console.log(usage());
        runtime.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${value}`);
        console.error(usage());
        runtime.exit(2);
    }
  }

  return parsed;
}

function requiredArgValue(values: readonly string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${flag} requires a value`);
    runtime.exit(2);
  }
  return value;
}

function usage(): string {
  return [
    'Usage:',
    '  bun run opentofu:plan-gate',
    '  bun run opentofu:plan-gate --target cloudflare --out-dir .opentofu-plan',
    '  TAKOS_OPENTOFU_BIN=/path/to/tofu bun run opentofu:plan-gate',
  ].join('\n');
}
