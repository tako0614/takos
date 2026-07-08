#!/usr/bin/env -S bun
import * as runtime from "./runtime.ts";

const requiredFiles = [
  '.github/dependabot.yml',
  '.github/workflows/patch-management.yml',
];
const privatePatchRunbookPath =
  '../takosumi-private/docs/operations/patch-management.md';

const dockerfiles = [
  'deploy/docker/takos-worker.Dockerfile',
  'containers/agent/Dockerfile',
];

const failures: string[] = [];

for (const path of requiredFiles) {
  if (!exists(path)) failures.push(`missing required patch-management file: ${path}`);
}

validateTextIncludes('.github/dependabot.yml', [
  'package-ecosystem: "github-actions"',
  'package-ecosystem: "docker"',
  'directory: "/deploy/docker"',
  'directory: "/containers/agent"',
  'package-ecosystem: "cargo"',
]);
validateTextIncludes('.github/workflows/patch-management.yml', [
  'aquasecurity/trivy-action@',
  'pinned: v0.36.0',
  'bun run validate:patch-management',
  'HIGH,CRITICAL',
]);
if (exists(privatePatchRunbookPath)) {
  validateTextIncludes(privatePatchRunbookPath, [
    'bun run validate:patch-management',
    'bun outdated',
    'Trivy',
    'Dependabot',
    'Critical exploited / internet-facing RCE',
  ]);
} else {
  console.warn(
    `Skipping private patch-management runbook validation: ${privatePatchRunbookPath} not found`,
  );
}

for (const dockerfile of dockerfiles) {
  validateDockerfile(dockerfile);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  runtime.exit(1);
}

console.log(`Validated patch management policy for ${dockerfiles.length} Dockerfile(s)`);

function validateDockerfile(path: string): void {
  if (!exists(path)) {
    failures.push(`missing Dockerfile: ${path}`);
    return;
  }

  const text = runtime.readTextFileSync(path);
  const fromLines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^FROM\s+/i.test(line));
  if (fromLines.length === 0) {
    failures.push(`${path}: Dockerfile must contain at least one FROM line`);
    return;
  }

  if (/\blatest\b/i.test(text)) {
    failures.push(`${path}: Dockerfile must not use latest image tags`);
  }

  for (const line of fromLines) {
    const image = line.split(/\s+/)[1];
    const tag = extractImageTag(image);
    if (!tag) {
      failures.push(`${path}: base image '${image}' must use an explicit tag or digest`);
      continue;
    }
    if (tag === 'latest') {
      failures.push(`${path}: base image '${image}' must not use latest`);
    }
    if (isMajorOnlyRuntimeTag(image, tag)) {
      failures.push(`${path}: base image '${image}' must pin runtime minor/patch version`);
    }
  }
}

function extractImageTag(image: string): string | undefined {
  if (image.includes('@sha256:')) return 'digest';
  const slashIndex = image.lastIndexOf('/');
  const colonIndex = image.indexOf(':', slashIndex + 1);
  if (colonIndex === -1) return undefined;
  return image.slice(colonIndex + 1);
}

function isMajorOnlyRuntimeTag(image: string, tag: string): boolean {
  const normalized = image.toLowerCase();
  if (normalized.startsWith('denoland/deno') || normalized.includes('/denoland/deno')) {
    return /^\d+$/.test(tag) || /^alpine-\d+$/.test(tag);
  }
  if (normalized.startsWith('rust') || normalized.includes('/rust')) {
    return /^\d+$/.test(tag);
  }
  return false;
}

function validateTextIncludes(path: string, expectedValues: readonly string[]): void {
  if (!exists(path)) return;
  const text = runtime.readTextFileSync(path);
  for (const expected of expectedValues) {
    if (!text.includes(expected)) {
      failures.push(`${path}: expected to contain '${expected}'`);
    }
  }
}

function exists(path: string): boolean {
  try {
    runtime.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof runtime.errors.NotFound) return false;
    throw error;
  }
}
