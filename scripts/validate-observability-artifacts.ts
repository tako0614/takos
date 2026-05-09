#!/usr/bin/env -S deno run --config deno.json --allow-read

const dashboardDir = "deploy/observability/grafana";
const costDashboardPath = `${dashboardDir}/takos-cost-attribution.json`;
const costRunbookPath = "docs/operations/cost-monitoring.md";

const dashboardFiles: string[] = [];
for (const entry of Deno.readDirSync(dashboardDir)) {
  if (entry.isFile && entry.name.endsWith(".json")) {
    dashboardFiles.push(`${dashboardDir}/${entry.name}`);
  }
}

if (!dashboardFiles.includes(costDashboardPath)) {
  fail(`missing required dashboard: ${costDashboardPath}`);
}

for (const path of dashboardFiles.toSorted()) {
  validateDashboard(path);
}

const runbook = Deno.readTextFileSync(costRunbookPath);
for (
  const expected of [
    "deploy/observability/grafana/takos-cost-attribution.json",
    "takos_cloud_spend_cents_total",
    "takos_billing_usage_cost_cents_total",
    "takos_app_usage_units_total",
    "takosumi/docs/reference/cost-attribution.md",
  ]
) {
  if (!runbook.includes(expected)) {
    fail(`${costRunbookPath} must mention ${expected}`);
  }
}

console.log(`Validated ${dashboardFiles.length} observability dashboard(s)`);

function validateDashboard(path: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Deno.readTextFileSync(path));
  } catch (error) {
    fail(
      `${path}: invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRecord(parsed)) fail(`${path}: dashboard must be a JSON object`);
  assertNonEmptyString(path, parsed, "uid");
  assertNonEmptyString(path, parsed, "title");

  const panels = parsed.panels;
  if (!Array.isArray(panels) || panels.length === 0) {
    fail(`${path}: dashboard must define at least one panel`);
  }

  const templating = parsed.templating;
  if (!isRecord(templating) || !Array.isArray(templating.list)) {
    fail(`${path}: dashboard must define templating.list`);
  }

  const hasPrometheusDatasource = templating.list.some((item) =>
    isRecord(item) && item.name === "DS_PROMETHEUS" &&
    item.type === "datasource" && item.query === "prometheus"
  );
  if (!hasPrometheusDatasource) {
    fail(`${path}: dashboard must define DS_PROMETHEUS datasource variable`);
  }

  for (const panel of panels) {
    if (!isRecord(panel)) fail(`${path}: panel must be a JSON object`);
    assertNonEmptyString(path, panel, "title");
    if (!Array.isArray(panel.targets) || panel.targets.length === 0) {
      fail(`${path}: panel "${panel.title}" must define targets`);
    }
    for (const target of panel.targets) {
      if (!isRecord(target)) {
        fail(`${path}: panel "${panel.title}" target must be an object`);
      }
      assertNonEmptyString(path, target, "expr");
      assertNonEmptyString(path, target, "refId");
    }
  }
}

function assertNonEmptyString(
  path: string,
  object: Record<string, unknown>,
  key: string,
): void {
  if (typeof object[key] !== "string" || object[key].trim().length === 0) {
    fail(`${path}: ${key} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}
