/**
 * ジョブ戦略マトリクスの展開（GitHub Actions 互換）
 *
 * 展開ロジック:
 * 1. `include` と `exclude` を除いたキーから cartesian product を計算する
 * 2. `exclude` に一致する組み合わせを除外する
 * 3. `include` エントリはベース組み合わせを拡張（既存値は上書きしない）か、
 *    一致するものが無ければ新しい組み合わせとして追加する
 *
 * 参考:
 * https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs
 */
import type {
  JobStrategy,
  MatrixConfig,
  MatrixContext,
  StrategyContext,
} from '../workflow-models.ts';

/**
 * マトリクス展開の結果（展開された組み合わせ 1 件）
 */
export interface MatrixExpansion {
  /** 展開された context.matrix 値（combination が空の場合は undefined） */
  matrix?: MatrixContext;
  /** 展開された context.strategy 値 */
  strategy: StrategyContext;
  /** この組み合わせに対応する安定的なハッシュ（ID サフィックス用） */
  hash: string;
}

/**
 * ベース組み合わせ用のキーを取り出す（include/exclude は除く）
 */
function getMatrixBaseKeys(matrix: MatrixConfig): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(matrix)) {
    if (key === 'include' || key === 'exclude') {
      continue;
    }
    keys.push(key);
  }
  return keys;
}

/**
 * 2 つのマトリクス組み合わせが同じベース値を共有するかを判定する。
 * `exclude` と include マッチングで使用する。
 */
function matchesExcludeEntry(
  combination: MatrixContext,
  excludeEntry: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(excludeEntry)) {
    if (!(key in combination)) {
      return false;
    }
    if (!deepEqual(combination[key], value)) {
      return false;
    }
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== typeof b) {
    return false;
  }
  if (typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
}

/**
 * matrix キーから cartesian product を構築する。
 */
function buildCartesianProduct(
  matrix: MatrixConfig,
  keys: string[]
): MatrixContext[] {
  if (keys.length === 0) {
    return [];
  }

  let combinations: MatrixContext[] = [{}];

  for (const key of keys) {
    const rawValues = matrix[key];
    if (!Array.isArray(rawValues) || rawValues.length === 0) {
      continue;
    }

    const next: MatrixContext[] = [];
    for (const combination of combinations) {
      for (const value of rawValues) {
        next.push({ ...combination, [key]: value });
      }
    }
    combinations = next;
  }

  return combinations;
}

/**
 * GitHub Actions の include セマンティクスを適用する:
 * - include エントリがベース matrix のキーのみを指定し、
 *   その値がいずれかの既存組み合わせと一致する場合、
 *   include の新しいキーを全ての一致する組み合わせに追加する
 *   （既存のベース値は上書きしない）
 * - それ以外の場合、include エントリは独立した新しい組み合わせとして追加される
 */
function applyIncludeEntries(
  combinations: MatrixContext[],
  includes: Record<string, unknown>[],
  baseKeys: string[]
): MatrixContext[] {
  const baseKeySet = new Set(baseKeys);
  const result: MatrixContext[] = combinations.map((entry) => ({ ...entry }));

  for (const includeEntry of includes) {
    const includeBaseKeys = Object.keys(includeEntry).filter((key) =>
      baseKeySet.has(key)
    );
    const includeExtraKeys = Object.keys(includeEntry).filter(
      (key) => !baseKeySet.has(key)
    );

    // ベース matrix キーが無い include は新しい combination を追加するだけ
    if (includeBaseKeys.length === 0) {
      result.push({ ...includeEntry });
      continue;
    }

    // 既存の combination のうち指定された全ベースキーが一致するものを探す
    let matched = false;
    for (const combination of result) {
      let matchesAll = true;
      for (const key of includeBaseKeys) {
        if (!deepEqual(combination[key], includeEntry[key])) {
          matchesAll = false;
          break;
        }
      }
      if (!matchesAll) {
        continue;
      }
      matched = true;

      // 一致した combination を extra キーで拡張（既存値は保持）
      for (const key of includeExtraKeys) {
        if (!(key in combination)) {
          combination[key] = includeEntry[key];
        }
      }
    }

    if (!matched) {
      // GitHub Actions: include が既存 combination と一致しない場合、
      // エントリそのものが新しい combination として追加される
      result.push({ ...includeEntry });
    }
  }

  return result;
}

/**
 * 組み合わせのハッシュ文字列を計算する。
 * 入力キー順に依存しない安定した ID サフィックスを生成する。
 */
function hashMatrixCombination(combination: MatrixContext): string {
  const sortedKeys = Object.keys(combination).sort();
  const segments: string[] = [];
  for (const key of sortedKeys) {
    const value = combination[key];
    let serialized: string;
    if (typeof value === 'string') {
      serialized = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      serialized = String(value);
    } else if (value === null || value === undefined) {
      serialized = 'null';
    } else {
      serialized = JSON.stringify(value);
    }
    segments.push(`${key}=${serialized}`);
  }
  if (segments.length === 0) {
    return 'default';
  }
  // Replace potentially unsafe characters so the id suffix stays filesystem-friendly
  const joined = segments.join(',');
  return joined.replace(/[^A-Za-z0-9_\-=,.]/g, '_');
}

/**
 * マトリクスを展開して組み合わせ一覧を返す。
 *
 * `matrix` が未指定 / 空の場合は空配列を返す（呼び出し側で単発実行扱いにする）。
 */
export function expandMatrix(
  strategy: JobStrategy | undefined
): MatrixExpansion[] {
  if (!strategy?.matrix) {
    return [];
  }

  const matrix = strategy.matrix;
  const baseKeys = getMatrixBaseKeys(matrix);

  // 生の cartesian product を計算
  const baseCombinations = buildCartesianProduct(matrix, baseKeys);

  // exclude を適用
  const excludeEntries = Array.isArray(matrix.exclude)
    ? (matrix.exclude as Record<string, unknown>[])
    : [];
  const filteredCombinations = baseCombinations.filter((combination) => {
    for (const excludeEntry of excludeEntries) {
      if (matchesExcludeEntry(combination, excludeEntry)) {
        return false;
      }
    }
    return true;
  });

  // include を適用
  const includeEntries = Array.isArray(matrix.include)
    ? (matrix.include as Record<string, unknown>[])
    : [];
  const combinationsWithIncludes = applyIncludeEntries(
    filteredCombinations,
    includeEntries,
    baseKeys
  );

  // ベースキー無しで include だけが指定されていた場合、
  // buildCartesianProduct は [] を返しているので include から組み立てる。
  if (baseKeys.length === 0 && combinationsWithIncludes.length === 0) {
    for (const entry of includeEntries) {
      combinationsWithIncludes.push({ ...entry });
    }
  }

  // 有効な組み合わせが 1 件も無ければ空（単発実行扱いに退化する）
  if (combinationsWithIncludes.length === 0) {
    return [];
  }

  const failFast = strategy['fail-fast'] ?? true;
  const maxParallel = strategy['max-parallel'] ?? combinationsWithIncludes.length;

  // 各組み合わせを MatrixExpansion へ変換
  const expansions: MatrixExpansion[] = combinationsWithIncludes.map(
    (combination, index) => ({
      matrix: combination,
      strategy: {
        'fail-fast': failFast,
        'job-index': index,
        'job-total': combinationsWithIncludes.length,
        'max-parallel': maxParallel,
      },
      hash: hashMatrixCombination(combination),
    })
  );

  return expansions;
}

/**
 * ベース ID と組み合わせハッシュから展開ジョブ ID を生成する。
 */
export function buildMatrixJobId(baseId: string, hash: string): string {
  return `${baseId}-${hash}`;
}
