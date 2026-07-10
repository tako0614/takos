#!/usr/bin/env -S bun

import process from "node:process";

const command = [
  "bunx",
  "tsc",
  "--noEmit",
  "-p",
  "web/tsconfig.json",
  "--pretty",
  "false",
];

const child = Bun.spawn(command, {
  cwd: import.meta.dir.replace(/\/scripts$/, ""),
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const diagnostics = `${stdout}\n${stderr}`
  .split(/\r?\n/)
  .filter((line) => line.includes("error TS"));
const unresolved = diagnostics.filter((line) =>
  /^web\/src\/(?!__tests__\/).*error TS(?:2304|2552):/.test(line)
);

if (unresolved.length > 0) {
  console.error("Web production sources contain unresolved identifiers:");
  for (const diagnostic of unresolved) {
    console.error(diagnostic);
  }
  process.exit(1);
}

if (exitCode !== 0 && diagnostics.length === 0) {
  console.error(stderr || stdout || `TypeScript exited with code ${exitCode}`);
  process.exit(1);
}

console.log(
  `Web unresolved-identifier check passed (${diagnostics.length} other TypeScript diagnostics reported).`,
);
