#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(new URL("..", import.meta.url).pathname);
const checkMode = process.argv.includes("--check");
const expectedLayoutPaths = [
  "src/worker",
  "src/worker/server/routes",
  "src/contracts",
  "web",
  "containers/git",
  "containers/agent",
];
const legacySourceRoots = ["agent", "app", "git"];
const expectedServices = [
  "postgres",
  "postgres-init",
  "redis",
  "takos-worker",
  "takos-git",
  "takosumi",
  "takos-agent",
];
const expectedPortMarkers = [
  "${TAKOS_WORKER_PORT:-8787}",
  "${TAKOSUMI_PORT:-8788}",
  "${TAKOS_AGENT_PORT:-8789}",
  "${TAKOS_GIT_PORT:-8790}",
  "${TAKOS_POSTGRES_PORT:-15432}",
  "${TAKOS_REDIS_PORT:-16379}",
];
const expectedInternalUrlMarkers = [
  "TAKOS_GIT_INTERNAL_URL",
  "TAKOSUMI_INTERNAL_URL",
  "TAKOS_AGENT_INTERNAL_URL",
  "TAKOS_INTERNAL_SERVICE_SECRET",
  "TAKOS_INTERNAL_API_SECRET",
  "TAKOSUMI_INTERNAL_API_SECRET",
];
const forbiddenSurfacePatterns = [
  {
    name: "standalone takos-deploy service",
    pattern: /\btakos-deploy\b/g,
  },
  {
    name: "retired deploy env",
    pattern: /\bTAKOS_DEPLOY_[A-Z0-9_]*\b/g,
  },
  {
    name: "retired control internal URL env",
    pattern: /\bTAKOS_CONTROL_INTERNAL_URL\b/g,
  },
  {
    name: "retired runtime internal URL env",
    pattern: /\bTAKOS_RUNTIME_INTERNAL_URL\b/g,
  },
  {
    name: "shell deploy implementation mount",
    pattern: /(^|["'\s])\.\/deploy(?:["'\s:]|$)/g,
  },
  {
    name: "shell runtime implementation mount",
    pattern: /(^|["'\s])\.\/runtime(?:["'\s:]|$)/g,
  },
];
const surfaceFiles = [
  "README.md",
  "AGENTS.md",
  "compose.local.yml",
  "package.json",
  ".env.local.example",
];

const results = [];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function pass(name, detail = "") {
  results.push({ status: "pass", name, detail });
}

function warn(name, detail = "") {
  results.push({ status: "warn", name, detail });
}

function fail(name, detail = "") {
  results.push({ status: "fail", name, detail });
}

function checkTool(name, args, displayName = name) {
  const result = run(name, args);
  if (result.status === 0) {
    const version =
      (result.stdout || result.stderr).split("\n").find(Boolean) ?? "available";
    pass(`${displayName} available`, version.trim());
    return true;
  }
  fail(
    `${displayName} available`,
    (result.stderr || result.stdout || "not found").trim(),
  );
  return false;
}

function checkCanonicalLayout() {
  const gitmodulesPath = join(root, ".gitmodules");
  if (existsSync(gitmodulesPath)) {
    fail("nested submodules removed", ".gitmodules should not exist in takos/");
  } else {
    pass("nested submodules removed", "takos source is owned by this repo");
  }

  for (const path of expectedLayoutPaths) {
    const ownerPath = join(root, path);
    if (!existsSync(ownerPath)) {
      fail(`canonical layout ${path} present`, "path is missing");
      continue;
    }
    const nestedGitPath = join(ownerPath, ".git");
    if (existsSync(nestedGitPath)) {
      fail(
        `canonical layout ${path} absorbed`,
        `${path}/.git should not exist`,
      );
      continue;
    }
    pass(`canonical layout ${path}`, relative(root, ownerPath));
  }

  for (const path of legacySourceRoots) {
    const legacyPath = join(root, path);
    if (existsSync(legacyPath)) {
      fail(
        `legacy source root ${path} removed`,
        `${path}/ must move to src/, web/, or containers/`,
      );
    } else {
      pass(`legacy source root ${path} removed`);
    }
  }
}

function serviceNamesFromComposeText(text) {
  const names = [];
  let inServices = false;
  for (const line of text.split("\n")) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-zA-Z0-9_-]+:\s*$/.test(line)) break;
    const match = inServices
      ? line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/)
      : undefined;
    if (match) names.push(match[1]);
  }
  return names;
}

function checkCompose(dockerComposeAvailable) {
  const composePath = join(root, "compose.local.yml");
  if (!existsSync(composePath)) {
    fail("compose.local.yml present", "missing");
    return;
  }
  const text = readFileSync(composePath, "utf8");
  pass("compose.local.yml present", relative(root, composePath));

  const staticServices = serviceNamesFromComposeText(text);
  const extraServices = staticServices.filter(
    (name) => !expectedServices.includes(name),
  );
  const missingServices = expectedServices.filter(
    (name) => !staticServices.includes(name),
  );
  if (extraServices.length || missingServices.length) {
    fail(
      "compose service set",
      `missing=[${missingServices.join(", ")}] extra=[${extraServices.join(", ")}]`,
    );
  } else {
    pass("compose service set", expectedServices.join(", "));
  }

  if (dockerComposeAvailable) {
    const config = run("docker", [
      "compose",
      "--env-file",
      ".env.local.example",
      "-f",
      "compose.local.yml",
      "config",
      "--services",
    ]);
    if (config.status === 0) {
      const resolved = config.stdout.trim().split("\n").filter(Boolean).sort();
      const expected = [...expectedServices].sort();
      if (JSON.stringify(resolved) === JSON.stringify(expected)) {
        pass("docker compose config --services", resolved.join(", "));
      } else {
        fail(
          "docker compose config --services",
          `got=[${resolved.join(", ")}] expected=[${expected.join(", ")}]`,
        );
      }
    } else {
      fail(
        "docker compose config --services",
        (config.stderr || config.stdout).trim(),
      );
    }
  }

  for (const marker of expectedPortMarkers) {
    if (text.includes(marker)) pass(`compose port marker ${marker}`);
    else fail(`compose port marker ${marker}`, "missing");
  }
  for (const marker of expectedInternalUrlMarkers) {
    if (text.includes(marker)) pass(`compose env marker ${marker}`);
    else fail(`compose env marker ${marker}`, "missing");
  }
}

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      [".git", "node_modules", "dist", "target", ".vitepress"].includes(
        entry.name,
      )
    )
      continue;
    const fullPath = join(dir, entry.name);
    if (relative(root, fullPath) === "scripts/doctor.mjs") continue;
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function checkForbiddenSurface() {
  const files = [
    ...surfaceFiles.map((file) => join(root, file)).filter(existsSync),
    ...(existsSync(join(root, "scripts"))
      ? walkFiles(join(root, "scripts"))
      : []),
  ];
  let violationCount = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = relative(root, file);
    for (const check of forbiddenSurfacePatterns) {
      for (const match of text.matchAll(check.pattern)) {
        violationCount += 1;
        const line = text.slice(0, match.index ?? 0).split("\n").length;
        fail(`forbidden ${check.name}`, `${rel}:${line}`);
      }
    }
  }
  if (violationCount === 0)
    pass("forbidden shell names absent", "current shell surface");
}

function checkDocs() {
  const requiredDocs = [
    { path: "docs/architecture/service-topology.md" },
    { path: "docs/get-started/local-shell.md" },
  ];
  for (const doc of requiredDocs) {
    const label = doc.label ?? doc.path;
    if (existsSync(join(root, doc.path))) pass(`doc ${label}`);
    else fail(`doc ${label}`, "missing");
  }

  const ecosystemComponentMatrix = join(
    root,
    "../docs/reference/component-matrix.md",
  );
  if (existsSync(ecosystemComponentMatrix)) {
    pass("doc ecosystem docs/reference/component-matrix.md");
  } else {
    warn(
      "doc ecosystem docs/reference/component-matrix.md",
      "not present in standalone takos checkout",
    );
  }
}

function printResults() {
  const icons = { pass: "ok", warn: "warn", fail: "fail" };
  for (const result of results) {
    const detail = result.detail ? ` - ${result.detail}` : "";
    console.log(`${icons[result.status]} ${result.name}${detail}`);
  }
  const summary = {
    pass: results.filter((result) => result.status === "pass").length,
    warn: results.filter((result) => result.status === "warn").length,
    fail: results.filter((result) => result.status === "fail").length,
  };
  console.log(
    `\nsummary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed`,
  );
  if (summary.fail > 0 && checkMode) process.exitCode = 1;
}

const gitAvailable = checkTool("git", ["--version"]);
checkTool("bun", ["--version"]);
const dockerComposeAvailable = checkTool(
  "docker",
  ["compose", "version"],
  "docker compose",
);

if (gitAvailable) checkCanonicalLayout();
checkCompose(dockerComposeAvailable);
checkForbiddenSurface();
checkDocs();
printResults();
