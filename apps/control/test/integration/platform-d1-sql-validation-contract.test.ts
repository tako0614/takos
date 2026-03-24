import { describe, expect, it } from 'vitest';
import {
  validateD1MigrationSql,
  validateD1QuerySql,
} from '@/application/services/execution/sql-validation';

describe('platform D1 SQL validation helpers', () => {
  describe('validateD1QuerySql', () => {
    it('accepts a single statement query', () => {
      const result = validateD1QuerySql('SELECT id, email FROM users WHERE id = ?');

      expect(result.valid).toBe(true);
      expect(result.statement).toBe('SELECT id, email FROM users WHERE id = ?');
    });

    it('allows semicolons inside string literals', () => {
      const result = validateD1QuerySql("SELECT 'a;b;c' AS message");

      expect(result.valid).toBe(true);
      expect(result.statement).toBe("SELECT 'a;b;c' AS message");
    });

    it('rejects semicolons used as statement separators', () => {
      const result = validateD1QuerySql('SELECT 1; SELECT 2');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Semicolons are not allowed');
    });

    it.each([
      'SELECT 1 -- inline comment',
      'SELECT /* block comment */ 1',
    ])('rejects SQL comments: %s', (sql) => {
      const result = validateD1QuerySql(sql);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('comments are not allowed');
    });

    it.each([
      'ATTACH DATABASE ? AS other_db',
      "SELECT load_extension('evil.so')",
      'PRAGMA journal_mode = WAL',
    ])('rejects forbidden verbs: %s', (sql) => {
      const result = validateD1QuerySql(sql);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('forbidden verb');
    });

    it('rejects unsupported statement verbs on query endpoint', () => {
      const result = validateD1QuerySql('DROP TABLE users');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('rejects write statements on read-only query endpoint', () => {
      const result = validateD1QuerySql('DELETE FROM users WHERE id = ?');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('read-only');
    });
  });

  describe('validateD1MigrationSql', () => {
    it('splits multiple statements while keeping semicolons inside literals', () => {
      const result = validateD1MigrationSql(
        "INSERT INTO logs(message) VALUES ('a;b'); UPDATE logs SET message = 'ok' WHERE id = 1",
      );

      expect(result.valid).toBe(true);
      expect(result.statements).toEqual([
        "INSERT INTO logs(message) VALUES ('a;b')",
        "UPDATE logs SET message = 'ok' WHERE id = 1",
      ]);
    });

    it('allows DDL statements for migration endpoint', () => {
      const result = validateD1MigrationSql(
        'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT); DROP TABLE IF EXISTS notes_old',
      );

      expect(result.valid).toBe(true);
      expect(result.statements).toHaveLength(2);
    });

    it.each([
      'CREATE TABLE t(id INTEGER); -- comment',
      '/* preface */ CREATE TABLE t(id INTEGER)',
    ])('rejects comment abuse in migrations: %s', (sql) => {
      const result = validateD1MigrationSql(sql);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('comments are not allowed');
    });

    it('rejects forbidden migration verbs', () => {
      const result = validateD1MigrationSql('ATTACH DATABASE ? AS other_db');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('forbidden verb');
    });

    it('rejects unterminated quoted strings', () => {
      const result = validateD1MigrationSql("INSERT INTO logs(message) VALUES('unterminated)");

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unterminated SQL string');
    });
  });
});
