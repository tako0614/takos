/**
 * RoutingDO rollout gate checker and optional promoter.
 *
 * Usage:
 *   pnpm -C scripts tsx check-routing-do-gate.ts \
 *     --target-phase 3 \
 *     --days 7 \
 *     --mismatch-rate 0.05 \
 *     --rollback-count 0 \
 *     [--apply]
 *
 * Notes:
 * - mismatch-rate is percentage value (e.g. 0.08 means 0.08%)
 * - --apply updates ROUTING_DO_PHASE in wrangler files only when gate passes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type TargetPhase = 3 | 4;

interface CliArgs {
  targetPhase: TargetPhase;
  days: number;
  mismatchRate: number;
  rollbackCount: number;
  apply: boolean;
}

interface GateResult {
  ok: boolean;
  reasons: string[];
}

const PHASE_PATTERN = /ROUTING_DO_PHASE\s*=\s*"([1-4])"/g;
const WRANGLER_FILES = [
  'apps/control/wrangler.toml',
  'apps/control/wrangler.dispatch.toml',
];
const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

function usageAndExit(message?: string): never {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.log(
    [
      'Usage:',
      '  tsx scripts/check-routing-do-gate.ts --target-phase <3|4> --days <n> --mismatch-rate <percent> --rollback-count <n> [--apply]',
      '',
      'Example:',
      '  tsx scripts/check-routing-do-gate.ts --target-phase 3 --days 7 --mismatch-rate 0.09 --rollback-count 0 --apply',
    ].join('\n')
  );
  process.exit(1);
}

function parseNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    usageAndExit(`${label} must be a finite number`);
  }
  return parsed;
}

type ValueArgHandler = (value: string) => void;

interface ValueArgDescriptor {
  flag: string;
  setValue: ValueArgHandler;
}

function readRequiredArgValue(
  argv: string[],
  index: number,
  flag: string
): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (!value) usageAndExit(`missing value for ${flag}`);
  return { value, nextIndex: index + 1 };
}

function parseTargetPhase(value: string): TargetPhase {
  const parsed = Number(value);
  if (parsed !== 3 && parsed !== 4) {
    usageAndExit('--target-phase must be 3 or 4');
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  let targetPhase: TargetPhase | undefined;
  let days: number | undefined;
  let mismatchRate: number | undefined;
  let rollbackCount: number | undefined;
  let apply = false;

  const valueArgDescriptors: ValueArgDescriptor[] = [
    {
      flag: '--target-phase',
      setValue: (value) => {
        targetPhase = parseTargetPhase(value);
      },
    },
    {
      flag: '--days',
      setValue: (value) => {
        days = parseNumber(value, '--days');
      },
    },
    {
      flag: '--mismatch-rate',
      setValue: (value) => {
        mismatchRate = parseNumber(value, '--mismatch-rate');
      },
    },
    {
      flag: '--rollback-count',
      setValue: (value) => {
        rollbackCount = parseNumber(value, '--rollback-count');
      },
    },
  ];
  const valueArgHandlers = new Map<string, ValueArgHandler>(
    valueArgDescriptors.map((descriptor) => [descriptor.flag, descriptor.setValue])
  );

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }

    const setValue = valueArgHandlers.get(arg);
    if (!setValue) {
      usageAndExit(`unknown argument: ${arg}`);
    }

    const { value, nextIndex } = readRequiredArgValue(argv, i, arg);
    setValue(value);
    i = nextIndex;
  }

  if (
    targetPhase === undefined ||
    days === undefined ||
    mismatchRate === undefined ||
    rollbackCount === undefined
  ) {
    usageAndExit('required arguments are missing');
  }

  if (days < 0) usageAndExit('--days must be >= 0');
  if (mismatchRate < 0) usageAndExit('--mismatch-rate must be >= 0');
  if (rollbackCount < 0) usageAndExit('--rollback-count must be >= 0');

  return { targetPhase, days, mismatchRate, rollbackCount, apply };
}

function evaluateGate(args: CliArgs): GateResult {
  const reasons: string[] = [];

  if (args.days < 7) {
    reasons.push(`requires 7 consecutive days, got ${args.days}`);
  }
  if (args.mismatchRate >= 0.1) {
    reasons.push(`mismatch rate must be < 0.1%, got ${args.mismatchRate}%`);
  }

  if (args.targetPhase === 4 && args.rollbackCount !== 0) {
    reasons.push(`phase 4 requires rollback-count = 0, got ${args.rollbackCount}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function readPhases(filePath: string): number[] {
  const content = readFileSync(filePath, 'utf8');
  return [...content.matchAll(PHASE_PATTERN)].map((m) => Number(m[1]));
}

function writePhase(filePath: string, phase: number): number {
  const content = readFileSync(filePath, 'utf8');
  let replacements = 0;
  const updated = content.replace(PHASE_PATTERN, () => {
    replacements += 1;
    return `ROUTING_DO_PHASE = "${phase}"`;
  });

  if (replacements > 0 && updated !== content) {
    writeFileSync(filePath, updated);
  }
  return replacements;
}

function main() {
  const args = parseArgs(process.argv);
  const gate = evaluateGate(args);

  const fileSummaries = WRANGLER_FILES.map((relativePath) => {
    const absolutePath = resolve(REPO_ROOT, relativePath);
    const phases = readPhases(absolutePath);
    return {
      path: relativePath,
      phases,
      uniquePhases: [...new Set(phases)],
    };
  });

  console.log('RoutingDO Gate Input');
  console.log(
    JSON.stringify(
      {
        targetPhase: args.targetPhase,
        days: args.days,
        mismatchRatePercent: args.mismatchRate,
        rollbackCount: args.rollbackCount,
        apply: args.apply,
      },
      null,
      2
    )
  );

  console.log('\nCurrent ROUTING_DO_PHASE values');
  console.log(JSON.stringify(fileSummaries, null, 2));

  if (!gate.ok) {
    console.error('\nGate Result: FAILED');
    for (const reason of gate.reasons) {
      console.error(`- ${reason}`);
    }
    process.exit(2);
  }

  console.log('\nGate Result: PASSED');

  if (!args.apply) {
    console.log('Dry-run mode: no files changed.');
    return;
  }

  let totalReplacements = 0;
  for (const file of WRANGLER_FILES) {
    totalReplacements += writePhase(resolve(REPO_ROOT, file), args.targetPhase);
  }

  console.log(`Applied phase=${args.targetPhase}. Updated entries: ${totalReplacements}`);
}

main();
