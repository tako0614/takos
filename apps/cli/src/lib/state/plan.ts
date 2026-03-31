import type { DiffResult } from './diff.ts';

const SYMBOLS: Record<string, string> = {
  create: '+',
  update: '~',
  delete: '-',
  unchanged: '=',
};

const LABELS: Record<string, string> = {
  create: '作成',
  update: '更新',
  delete: '削除',
  unchanged: '変更なし',
};

/**
 * DiffResult を plan 表示用の文字列にフォーマットする。
 *
 * 出力例:
 *   + db          d1          作成
 *   ~ web         Worker      コード更新
 *   - old-worker  Worker      削除
 *   = cache       kv          変更なし
 */
export function formatPlan(diff: DiffResult): string {
  if (diff.entries.length === 0) {
    return '変更はありません。';
  }

  const maxNameLen = Math.max(...diff.entries.map((e) => e.name.length));
  const maxTypeLen = Math.max(...diff.entries.map((e) => (e.type ?? e.category).length));

  const lines = diff.entries.map((entry) => {
    const symbol = SYMBOLS[entry.action] ?? '?';
    const name = entry.name.padEnd(maxNameLen);
    const type = (entry.type ?? entry.category).padEnd(maxTypeLen);
    const label = entry.reason ?? LABELS[entry.action] ?? entry.action;
    return `${symbol} ${name}  ${type}  ${label}`;
  });

  const summaryParts: string[] = [];
  if (diff.summary.create > 0) summaryParts.push(`作成: ${diff.summary.create}`);
  if (diff.summary.update > 0) summaryParts.push(`更新: ${diff.summary.update}`);
  if (diff.summary.delete > 0) summaryParts.push(`削除: ${diff.summary.delete}`);
  if (diff.summary.unchanged > 0) summaryParts.push(`変更なし: ${diff.summary.unchanged}`);

  lines.push('');
  lines.push(summaryParts.join(', '));

  return lines.join('\n');
}
