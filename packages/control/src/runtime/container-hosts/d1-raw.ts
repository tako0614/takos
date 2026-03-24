import type { D1PreparedStatement } from '../../shared/types/bindings.ts';

export type D1RawOptions = { columnNames: true } | { columnNames?: false };

export function executeD1RawStatement<T = unknown[]>(
  statement: D1PreparedStatement,
  rawOptions: { columnNames: true }
): Promise<[string[], ...T[]]>;
export function executeD1RawStatement<T = unknown[]>(
  statement: D1PreparedStatement,
  rawOptions?: { columnNames?: false }
): Promise<T[]>;
export async function executeD1RawStatement<T = unknown[]>(
  statement: D1PreparedStatement,
  rawOptions?: D1RawOptions
): Promise<T[] | [string[], ...T[]]> {
  if (rawOptions?.columnNames) {
    return statement.raw<T>({ columnNames: true });
  }

  return statement.raw<T>();
}
