/**
 * Inspect worker binding config in the selected Takos environment.
 *
 * Usage:
 *   node scripts/fix-worker-bindings.js <route-ref> [--local]
 *   node scripts/fix-worker-bindings.js <route-ref> --env staging|production
 */

const rawArgs = process.argv.slice(2);
const routeRef = rawArgs[0];
const ROUTE_REF_PATTERN = /^[a-zA-Z0-9_-]+$/;

let executionTarget = { kind: "local" };

for (let i = 1; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (arg === "--local") {
    executionTarget = { kind: "local" };
    continue;
  }
  if (arg === "--env") {
    const envName = rawArgs[i + 1];
    if (envName !== "staging" && envName !== "production") {
      console.error(
        "Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]",
      );
      process.exit(1);
    }
    executionTarget = { kind: "remote", env: envName };
    i += 1;
    continue;
  }
  console.error(
    "Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]",
  );
  process.exit(1);
}

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

if (!routeRef) {
  console.error(
    "Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]",
  );
  process.exit(1);
}

if (!ROUTE_REF_PATTERN.test(routeRef)) {
  console.error(
    "Invalid route ref. Only letters, numbers, hyphen, and underscore are allowed.",
  );
  process.exit(1);
}

async function main() {
  // Load wrangler config
  const { spawn } = await import("child_process");

  // Get service config from DB via canonical route_ref.
  const dbResult = await new Promise((resolve, reject) => {
    const sql = `SELECT config FROM services WHERE route_ref = ${
      sqlString(routeRef)
    }`;
    const args = executionTarget.kind === "local"
      ? [
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--local",
        "--command",
        sql,
        "--json",
      ]
      : [
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--env",
        executionTarget.env,
        "--command",
        sql,
        "--json",
      ];
    const proc = spawn("npx", args, { shell: false });

    let stdout = "";
    proc.stdout.on("data", (d) => stdout += d);
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`wrangler d1 execute failed with exit code ${code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout);
        const row = Array.isArray(payload) ? payload[0]?.results?.[0] : null;
        resolve(row ?? null);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse wrangler output: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    });
  });

  console.log("Service config:", dbResult);
}

main().catch(console.error);
