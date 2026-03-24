type ValidationResult = {
  valid: boolean;
  statement?: string;
  error?: string;
};

type MigrationValidationResult = {
  valid: boolean;
  statements?: string[];
  error?: string;
};

const MAX_SQL_LENGTH = 100_000; // 100KB max SQL statement
const MAX_BATCH_STATEMENTS = 100;

const FORBIDDEN_VERBS = new Set(['ATTACH', 'DETACH', 'LOAD_EXTENSION', 'PRAGMA']);
const QUERY_ALLOWED_VERBS = new Set(['SELECT', 'WITH', 'EXPLAIN']);
const FORBIDDEN_SQL_PATTERNS = [
  /\bLOAD_EXTENSION\s*\(/i,
];

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '');
}

function containsSqlComment(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) {
      continue;
    }
    if (char === '-' && next === '-') {
      return true;
    }
    if (char === '/' && next === '*') {
      return true;
    }
  }

  return false;
}

function splitSqlStatements(sql: string): { statements: string[]; error?: string } {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble && char === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (inSingle || inDouble) {
    return { statements: [], error: 'Unterminated SQL string' };
  }

  const trailing = current.trim();
  if (trailing) {
    statements.push(trailing);
  }

  return { statements };
}

function getStatementVerb(sql: string): string {
  const normalized = stripTrailingSemicolon(sql).trim().toUpperCase();
  return normalized.split(/\s+/, 1)[0] ?? '';
}

function isForbiddenVerb(sql: string): boolean {
  const verb = getStatementVerb(sql);
  return FORBIDDEN_VERBS.has(verb) || FORBIDDEN_SQL_PATTERNS.some((pattern) => pattern.test(sql));
}

export function validateD1QuerySql(sql: string): ValidationResult {
  if (sql.length > MAX_SQL_LENGTH) {
    return { valid: false, error: 'SQL statement exceeds maximum length' };
  }

  if (containsSqlComment(sql)) {
    return { valid: false, error: 'SQL comments are not allowed' };
  }

  const { statements, error } = splitSqlStatements(sql);
  if (error) {
    return { valid: false, error };
  }
  if (statements.length !== 1) {
    return { valid: false, error: 'Semicolons are not allowed in query statements' };
  }

  const statement = statements[0]!;
  if (isForbiddenVerb(statement)) {
    return { valid: false, error: 'SQL contains a forbidden verb' };
  }

  const verb = getStatementVerb(statement);
  if (!QUERY_ALLOWED_VERBS.has(verb)) {
    if (['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(verb)) {
      return { valid: false, error: 'Query endpoint is read-only' };
    }
    return { valid: false, error: `Statement verb ${verb || '(unknown)'} is not allowed` };
  }

  return { valid: true, statement: stripTrailingSemicolon(statement) };
}

export function validateD1ProxySql(sql: string): ValidationResult {
  if (sql.length > MAX_SQL_LENGTH) {
    return { valid: false, error: 'SQL statement exceeds maximum length' };
  }

  if (containsSqlComment(sql)) {
    return { valid: false, error: 'SQL comments are not allowed' };
  }

  const { statements, error } = splitSqlStatements(sql);
  if (error) {
    return { valid: false, error };
  }
  if (statements.length !== 1) {
    return { valid: false, error: 'Multi-statement SQL is not allowed in proxy' };
  }

  const statement = statements[0]!;
  if (isForbiddenVerb(statement)) {
    return { valid: false, error: 'SQL contains a forbidden verb' };
  }

  const verb = getStatementVerb(statement);
  const proxyAllowedVerbs = new Set([
    'SELECT', 'WITH', 'EXPLAIN', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE',
  ]);
  if (!proxyAllowedVerbs.has(verb)) {
    return { valid: false, error: `Statement verb ${verb || '(unknown)'} is not allowed in proxy` };
  }

  return { valid: true, statement: stripTrailingSemicolon(statement) };
}

export function validateD1MigrationSql(sql: string): MigrationValidationResult {
  if (sql.length > MAX_SQL_LENGTH * 10) {
    return { valid: false, error: 'SQL migration exceeds maximum length' };
  }

  if (containsSqlComment(sql)) {
    return { valid: false, error: 'SQL comments are not allowed' };
  }

  const { statements, error } = splitSqlStatements(sql);
  if (error) {
    return { valid: false, error };
  }
  if (statements.length === 0) {
    return { valid: false, error: 'No SQL statements provided' };
  }
  if (statements.length > MAX_BATCH_STATEMENTS) {
    return { valid: false, error: `Migration contains too many statements (max ${MAX_BATCH_STATEMENTS})` };
  }

  for (const statement of statements) {
    if (isForbiddenVerb(statement)) {
      return { valid: false, error: 'SQL contains a forbidden verb' };
    }
  }

  return { valid: true, statements: statements.map(stripTrailingSemicolon) };
}
