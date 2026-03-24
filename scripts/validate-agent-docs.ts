import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const configured = process.env.TAKOS_ECOSYSTEM_ROOT;
  const candidates = [
    configured,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const agentsPath = path.join(candidate, "AGENTS.md");
    const claudePath = path.join(candidate, "CLAUDE.md");
    if (existsSync(agentsPath) && statSync(agentsPath).isFile() &&
        existsSync(claudePath) && statSync(claudePath).isFile()) {
      return candidate;
    }
  }
  return process.cwd();
}

function main(): void {
  const root = resolveRepoRoot();
  const agentsPath = path.resolve(root, "AGENTS.md");
  const claudePath = path.resolve(root, "CLAUDE.md");

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(agentsPath)) {
    errors.push("AGENTS.md is missing.");
  }

  if (!existsSync(claudePath)) {
    errors.push("CLAUDE.md is missing.");
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exit(1);
  }

  const agents = readFileSync(agentsPath, "utf8");
  const claude = readFileSync(claudePath, "utf8");

  if (!claude.includes("AGENTS.md")) {
    errors.push("CLAUDE.md must explicitly reference AGENTS.md.");
  }

  const claudeLines = claude.split(/\r?\n/).length;
  if (claudeLines > 80) {
    errors.push(
      `CLAUDE.md is too long (${claudeLines} lines). keep it minimal and AGENTS.md-centric.`
    );
  } else if (claudeLines > 40) {
    warnings.push(
      `CLAUDE.md is ${claudeLines} lines. consider reducing duplication with AGENTS.md.`
    );
  }

  if (!agents.includes("ドキュメント駆動開発")) {
    warnings.push(
      "AGENTS.md does not explicitly contain 'ドキュメント駆動開発'."
    );
  }

  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exit(1);
  }

  console.log("agent docs validation passed.");
}

main();
