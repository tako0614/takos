const expectedRoles = [
  "takosumi-api",
  "takosumi-worker",
  "takosumi-router",
  "takosumi-runtime-agent",
  "takosumi-log-worker",
] as const;

const expectedRoleSet = new Set<string>(expectedRoles);

type FindingKind = "label" | "env";

type Finding = {
  file: string;
  line: number;
  kind: FindingKind;
  value: string;
};

const helmTemplateDir = "deploy/helm/takos/templates";

async function readTargets(): Promise<Array<{ path: string; text: string }>> {
  const targets: Array<{ path: string; text: string }> = [];

  for await (const entry of Deno.readDir(helmTemplateDir)) {
    if (!entry.isFile) continue;
    if (!/\.(ya?ml|tpl|txt)$/.test(entry.name)) continue;

    const path = `${helmTemplateDir}/${entry.name}`;
    targets.push({ path, text: await Deno.readTextFile(path) });
  }

  return targets.sort((a, b) => a.path.localeCompare(b.path));
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripInlineComment(value: string): string {
  const quote = value.trimStart()[0];
  if (quote === '"' || quote === "'") return value;
  return value.replace(/\s+#.*$/, "");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function collectFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];

  const labelPattern = /takos\.io\/process-role:\s*([^\n]+)/g;
  for (const match of text.matchAll(labelPattern)) {
    findings.push({
      file,
      line: lineOf(text, match.index ?? 0),
      kind: "label",
      value: unquote(stripInlineComment(match[1])),
    });
  }

  const composeEnvPattern = /TAKOSUMI_PROCESS_ROLE:\s*([^\n]+)/g;
  for (const match of text.matchAll(composeEnvPattern)) {
    findings.push({
      file,
      line: lineOf(text, match.index ?? 0),
      kind: "env",
      value: unquote(stripInlineComment(match[1])),
    });
  }

  const kubernetesEnvPattern =
    /-\s+name:\s*TAKOSUMI_PROCESS_ROLE\s*\n\s+value:\s*([^\n]+)/g;
  for (const match of text.matchAll(kubernetesEnvPattern)) {
    findings.push({
      file,
      line: lineOf(text, match.index ?? 0),
      kind: "env",
      value: unquote(stripInlineComment(match[1])),
    });
  }

  return findings;
}

function validate(findings: Finding[]): string[] {
  const errors: string[] = [];
  const seenByKind: Record<FindingKind, Set<string>> = {
    label: new Set(),
    env: new Set(),
  };

  for (const finding of findings) {
    if (!expectedRoleSet.has(finding.value)) {
      errors.push(
        `${finding.file}:${finding.line} has undocumented ${finding.kind} process role '${finding.value}'`,
      );
      continue;
    }
    seenByKind[finding.kind].add(finding.value);
  }

  for (const role of expectedRoles) {
    for (const kind of ["label", "env"] as const) {
      if (!seenByKind[kind].has(role)) {
        errors.push(`missing ${kind} process role '${role}'`);
      }
    }
  }

  return errors;
}

const targets = await readTargets();
const findings = targets.flatMap(({ path, text }) =>
  collectFindings(path, text)
);
const errors = validate(findings);

if (errors.length > 0) {
  console.error("Process role validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  Deno.exit(1);
}

const labelCount =
  findings.filter((finding) => finding.kind === "label").length;
const envCount = findings.filter((finding) => finding.kind === "env").length;

console.log(
  `Validated ${expectedRoles.length} documented process roles across ${targets.length} manifest files (${labelCount} labels, ${envCount} env values).`,
);
