/**
 * Platform query commands: users list, repos list, repos branches.
 */

import {
  DEFAULT_QUERY_LIMIT,
  executeD1Sql,
  extractResults,
  fail,
  type GlobalOptions,
  MAX_QUERY_LIMIT,
  parsePositiveInt,
  print,
  type ResolvedConfig,
  sqlLiteral,
  takeOption,
} from "./index.ts";

export async function cmdUsersList(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const limit = parsePositiveInt(
    takeOption(localArgs, "--limit"),
    "--limit",
    DEFAULT_QUERY_LIMIT,
    MAX_QUERY_LIMIT,
  );

  const sql = `
    SELECT id, name, email, username, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(rows as Record<string, unknown>[]);
    print(`Total: ${rows.length}`, options.isJson);
  }

  return rows.length;
}

export async function cmdReposList(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const limit = parsePositiveInt(
    takeOption(localArgs, "--limit"),
    "--limit",
    DEFAULT_QUERY_LIMIT,
    MAX_QUERY_LIMIT,
  );

  const sql = `
    SELECT r.id, r.name, r.space_id, r.visibility, r.created_at,
           w.name AS space_name
    FROM repositories r
    LEFT JOIN spaces w ON r.space_id = w.id
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;

  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(rows as Record<string, unknown>[]);
    print(`Total: ${rows.length}`, options.isJson);
  }

  return rows.length;
}

export async function cmdReposBranches(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const repoIdentifier = args[0];
  if (!repoIdentifier) {
    fail("Usage: repos branches <repo_id_or_name>");
  }

  const repoLookup = await executeD1Sql(
    config,
    `SELECT id, name FROM repositories WHERE id = ${
      sqlLiteral(repoIdentifier)
    } OR name = ${sqlLiteral(repoIdentifier)} LIMIT 1`,
  );
  const repo = extractResults(repoLookup)[0] as
    | Record<string, unknown>
    | undefined;

  if (!repo) {
    fail(`Repository not found: ${repoIdentifier}`);
  }

  const repoId = String(repo.id);
  const sql = `
    SELECT b.id, b.name, b.commit_sha, b.is_default, b.created_at, c.message AS commit_message
    FROM branches b
    LEFT JOIN commits c ON b.commit_sha = c.sha AND b.repo_id = c.repo_id
    WHERE b.repo_id = ${sqlLiteral(repoId)}
    ORDER BY b.is_default DESC, b.name
  `;

  const result = await executeD1Sql(config, sql);
  const rows = extractResults(result);

  if (options.isJson) {
    console.log(JSON.stringify({ repository: repo, branches: rows }, null, 2));
  } else {
    print(`Repository: ${String(repo.name)} (${repoId})`, options.isJson);
    console.table(rows as Record<string, unknown>[]);
    print(`Total: ${rows.length}`, options.isJson);
  }

  return rows.length;
}
