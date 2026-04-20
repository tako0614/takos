import { createEffect, createSignal, on } from "solid-js";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { getErrorMessage } from "takos-common/errors";
import type { Resource } from "../types/index.ts";
import type {
  D1QueryResult,
  D1TableData,
} from "../views/workers/worker-models.ts";

export function useResourceExplorer(resource: Resource) {
  const [d1Tables, setD1Tables] = createSignal<string[]>([]);
  const [d1TableData, setD1TableData] = createSignal<D1TableData | null>(null);
  const [d1SelectedTable, setD1SelectedTable] = createSignal<string | null>(
    null,
  );
  const [d1Query, setD1Query] = createSignal("");
  const [d1QueryResult, setD1QueryResult] = createSignal<D1QueryResult | null>(
    null,
  );
  const [d1Loading, setD1Loading] = createSignal(false);

  const fetchD1Tables = async () => {
    if (resource.type !== "d1") return;
    setD1Loading(true);
    try {
      const res = await rpc.resources[":id"].d1.tables.$get({
        param: { id: resource.id },
      });
      const result = await rpcJson<
        { tables: { name: string; row_count: number }[] }
      >(res);
      setD1Tables(result.tables?.map((t) => t.name) || []);
    } catch {
      setD1Tables([]);
    } finally {
      setD1Loading(false);
    }
  };

  createEffect(on(() => resource.name, () => {
    setD1Tables([]);
    setD1TableData(null);
    setD1SelectedTable(null);
    setD1Query("");
    setD1QueryResult(null);

    if (resource.type === "d1") {
      fetchD1Tables();
    }
  }));

  const fetchD1TableData = async (table: string) => {
    setD1Loading(true);
    try {
      const res = await rpc.resources[":id"].d1.tables[":tableName"].$get({
        param: { id: resource.id, tableName: table },
      });
      const result = await rpcJson<D1TableData>(res);
      setD1TableData(result);
      setD1SelectedTable(table);
    } catch {
      setD1TableData(null);
    } finally {
      setD1Loading(false);
    }
  };

  const executeD1Query = async () => {
    if (!d1Query().trim()) return;
    setD1Loading(true);
    try {
      const res = await rpcPath(rpc, "resources", ":id", "d1", "query").$post({
        param: { id: resource.id },
        json: { sql: d1Query() },
      });
      const result = await rpcJson<D1QueryResult>(res);
      setD1QueryResult(result);
    } catch (err: unknown) {
      setD1QueryResult({ error: getErrorMessage(err, "Query failed") });
    } finally {
      setD1Loading(false);
    }
  };

  return {
    d1Tables,
    d1TableData,
    d1SelectedTable,
    d1Query,
    d1QueryResult,
    d1Loading,
    onD1QueryChange: setD1Query,
    fetchD1TableData,
    executeD1Query,
  };
}
