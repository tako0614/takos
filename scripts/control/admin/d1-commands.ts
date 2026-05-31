/**
 * D1 database commands: ping, tables, query.
 */

import {
  enforceTenantSqlAccessPolicy,
  executeD1Sql,
  extractChangeCount,
  extractResults,
  type GlobalOptions,
  print,
  type ResolvedConfig,
  takeOption,
  validateQuerySafety,
} from "./index.ts";

export async function cmdD1Ping(
  config: ResolvedConfig,
  options: GlobalOptions,
): Promise<number> {
  const result = await executeD1Sql(config, "SELECT 1 AS ok");
  if (options.isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    print(`D1 ping succeeded (${config.environment})`, options.isJson);
    console.table(extractResults(result) as Record<string, unknown>[]);
  }
  return 1;
}

export async function cmdD1Tables(
  config: ResolvedConfig,
  options: GlobalOptions,
): Promise<number> {
  const result = await executeD1Sql(
    config,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );

  const rows = extractResults(result);
  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(rows as Record<string, unknown>[]);
  }
  return rows.length;
}

export async function cmdD1Query(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const sqlOption = takeOption(localArgs, "--sql");
  const sql = (sqlOption || localArgs.join(" ")).trim();
  if (!sql) {
    throw new Error('SQL query is required. Usage: d1 query "<sql>"');
  }

  validateQuerySafety(sql);
  enforceTenantSqlAccessPolicy(sql, options);
  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (rows.length > 0) {
    console.table(rows as Record<string, unknown>[]);
  } else {
    print("Query executed successfully.", options.isJson);
    print(`Affected rows: ${extractChangeCount(result)}`, options.isJson);
  }

  return extractChangeCount(result);
}
