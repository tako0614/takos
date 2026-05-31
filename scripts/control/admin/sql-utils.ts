/**
 * SQL utility functions: sqlLiteral, sqlNullable, escapeRegExp.
 */

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNullable(value: string | null | undefined): string {
  if (value == null) {
    return "NULL";
  }
  return sqlLiteral(value);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
