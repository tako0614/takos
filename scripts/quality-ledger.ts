/**
 * Declared-debt ledgers for the project-wide type gate, the linter, and the
 * test runner.
 *
 * A ledger is a per-file count of diagnostics the repository has decided to
 * carry for now. It is compared exactly, in both directions:
 *
 * - a file with more diagnostics than it declares fails, because the change
 *   under review added them;
 * - a file with fewer fails too, because the ledger is a countdown and the
 *   number that just got smaller has to be written down;
 * - a file that is not listed at all fails, so debt is never acquired
 *   silently;
 * - a listed file with no diagnostics left fails until its entry is deleted.
 *
 * The totals in the ledger are checked against the sum, so the number printed
 * by the gate is a number the ledger actually asserts rather than a running
 * commentary on whatever was found.
 */

import { readFile } from "node:fs/promises";

export type DebtLedger = {
  readonly note: string;
  readonly totals: { readonly files: number; readonly diagnostics: number };
  readonly files: Readonly<Record<string, number>>;
};

export type Diagnostic = {
  readonly file: string;
  readonly text: string;
};

export async function readDebtLedger(path: string): Promise<DebtLedger> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as DebtLedger;
  if (
    typeof parsed?.note !== "string" ||
    typeof parsed?.totals?.files !== "number" ||
    typeof parsed?.totals?.diagnostics !== "number" ||
    typeof parsed?.files !== "object" || parsed.files === null
  ) {
    throw new Error(`${path}: not a debt ledger`);
  }
  const declaredFiles = Object.keys(parsed.files).length;
  const declaredDiagnostics = Object.values(parsed.files)
    .reduce((sum, count) => sum + count, 0);
  if (
    declaredFiles !== parsed.totals.files ||
    declaredDiagnostics !== parsed.totals.diagnostics
  ) {
    throw new Error(
      `${path}: totals say ${parsed.totals.files} file(s) / ` +
        `${parsed.totals.diagnostics} diagnostic(s) but the entries sum to ` +
        `${declaredFiles} / ${declaredDiagnostics}`,
    );
  }
  return parsed;
}

export function countByFile(
  diagnostics: readonly Diagnostic[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.file, (counts.get(diagnostic.file) ?? 0) + 1);
  }
  return counts;
}

/** Returns the human-readable failures; an empty array means the gate passes. */
export function compareToLedger(
  ledger: DebtLedger,
  ledgerPath: string,
  diagnostics: readonly Diagnostic[],
): string[] {
  const actual = countByFile(diagnostics);
  const failures: string[] = [];
  const byFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const bucket = byFile.get(diagnostic.file);
    if (bucket) bucket.push(diagnostic);
    else byFile.set(diagnostic.file, [diagnostic]);
  }

  for (const [file, count] of [...actual].sort()) {
    const declared = ledger.files[file];
    if (declared === undefined) {
      failures.push(
        `${file}: ${count} diagnostic(s), and the file is not in ${ledgerPath}`,
      );
      for (const diagnostic of byFile.get(file) ?? []) {
        failures.push(`    ${diagnostic.text}`);
      }
      continue;
    }
    if (count > declared) {
      failures.push(
        `${file}: ${count} diagnostic(s), ${ledgerPath} declares ${declared}`,
      );
      for (const diagnostic of byFile.get(file) ?? []) {
        failures.push(`    ${diagnostic.text}`);
      }
      continue;
    }
    if (count < declared) {
      failures.push(
        `${file}: down to ${count} diagnostic(s) from the declared ` +
          `${declared}; lower the count in ${ledgerPath}`,
      );
    }
  }

  for (const file of Object.keys(ledger.files).sort()) {
    if (!actual.has(file)) {
      failures.push(
        `${file}: no diagnostics left; delete its entry from ${ledgerPath}`,
      );
    }
  }
  return failures;
}

export function reportLedger(
  label: string,
  ledger: DebtLedger,
  diagnostics: readonly Diagnostic[],
  ledgerPath: string,
): number {
  const failures = compareToLedger(ledger, ledgerPath, diagnostics);
  if (failures.length > 0) {
    console.error(`${label} failed:`);
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }
  console.log(
    `${label} passed: 0 undeclared diagnostics; declared debt is ` +
      `${ledger.totals.diagnostics} diagnostic(s) across ` +
      `${ledger.totals.files} file(s).`,
  );
  return 0;
}
