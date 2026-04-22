import { useI18n } from "../../../store/i18n.ts";
import { Icons } from "../../../lib/Icons.tsx";
import type { Resource } from "../../../types/index.ts";
import { useResourceExplorer } from "../../../hooks/useResourceExplorer.ts";

interface D1ExplorerTabProps {
  resource: Resource;
}

export function D1ExplorerTab(props: D1ExplorerTabProps) {
  const { t } = useI18n();
  const {
    d1Tables,
    d1TableData,
    d1SelectedTable,
    d1Query,
    d1QueryResult,
    d1Loading,
    onD1QueryChange,
    fetchD1TableData,
    executeD1Query,
  } = useResourceExplorer(props.resource);

  return (
    <div class="flex gap-6 h-full" role="region" aria-label={t("explorer")}>
      <nav class="w-64 flex-shrink-0" aria-label="Database tables">
        <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
          {t("tables")}
        </h4>
        {d1Loading() && d1Tables().length === 0 && (
          <div
            class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400"
            role="status"
            aria-label="Loading tables"
          >
            <Icons.Loader class="w-4 h-4 animate-spin" />
          </div>
        )}
        <div class="space-y-1" role="listbox" aria-label="Table list">
          {d1Tables().map((table: string) => (
            <button
              type="button"
              role="option"
              aria-selected={d1SelectedTable() === table}
              class={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                d1SelectedTable() === table
                  ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
              onClick={() => fetchD1TableData(table)}
            >
              <Icons.Database class="w-4 h-4" aria-hidden="true" />
              <span>{table}</span>
            </button>
          ))}
          {d1Tables().length === 0 && !d1Loading() && (
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {t("noTables")}
            </p>
          )}
        </div>
      </nav>
      <div class="flex-1 space-y-4">
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4
            class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3"
            id="sql-console-heading"
          >
            {t("sqlConsole")}
          </h4>
          <textarea
            aria-labelledby="sql-console-heading"
            class="w-full h-24 px-3 py-2 bg-zinc-100 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50 placeholder:text-zinc-500 dark:placeholder:text-zinc-400"
            value={d1Query()}
            onInput={(e) =>
              onD1QueryChange(e.currentTarget.value)}
            placeholder="SELECT * FROM users LIMIT 10"
          />
          <button
            type="button"
            class="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            onClick={executeD1Query}
            disabled={d1Loading() || !d1Query().trim()}
            aria-label={t("execute") + " SQL query"}
          >
            <Icons.Play class="w-4 h-4" aria-hidden="true" />
            <span>{t("execute")}</span>
          </button>
        </div>
        {d1TableData() && (
          <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
            <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
              {d1SelectedTable()}
            </h4>
            <div
              class="overflow-auto max-h-96"
              tabIndex={0}
              role="region"
              aria-label={`Table data for ${d1SelectedTable()}`}
            >
              <table
                class="w-full text-sm"
                aria-label={`${d1SelectedTable()} contents`}
              >
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700">
                    {d1TableData()!.columns.map((col: string) => (
                      <th
                        scope="col"
                        class="px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {d1TableData()!.rows.map((
                    row: Record<string, unknown>,
                    _i: number,
                  ) => (
                    <tr class="hover:bg-zinc-100 dark:hover:bg-zinc-700">
                      {d1TableData()!.columns.map((col: string) => (
                        <td class="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {d1QueryResult() && (
          <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
            <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
              {t("result")}
            </h4>
            <pre
              class="text-xs text-zinc-500 dark:text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-700 p-3 rounded-lg overflow-auto max-h-64"
              tabIndex={0}
              role="region"
              aria-label="Query result"
            >
              {JSON.stringify(d1QueryResult(), null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
