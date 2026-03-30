import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { getErrorMessage } from 'takos-common/errors';
import type { Resource } from '../types';
import type { D1QueryResult, D1TableData } from '../views/workers/types';

export function useResourceExplorer(resource: Resource) {
  const [d1Tables, setD1Tables] = useState<string[]>([]);
  const [d1TableData, setD1TableData] = useState<D1TableData | null>(null);
  const [d1SelectedTable, setD1SelectedTable] = useState<string | null>(null);
  const [d1Query, setD1Query] = useState('');
  const [d1QueryResult, setD1QueryResult] = useState<D1QueryResult | null>(null);
  const [d1Loading, setD1Loading] = useState(false);

  useEffect(() => {
    setD1Tables([]);
    setD1TableData(null);
    setD1SelectedTable(null);
    setD1Query('');
    setD1QueryResult(null);

    if (resource.type === 'd1') {
      fetchD1Tables();
    }
  }, [resource.name]);

  const fetchD1Tables = useCallback(async () => {
    if (resource.type !== 'd1' || !resource.provider_resource_id) return;
    setD1Loading(true);
    try {
      const res = await rpc.resources[':id'].d1.tables.$get({ param: { id: resource.id } });
      const result = await rpcJson<{ tables: { name: string; row_count: number }[] }>(res);
      setD1Tables(result.tables?.map(t => t.name) || []);
    } catch {
      setD1Tables([]);
    } finally {
      setD1Loading(false);
    }
  }, [resource]);

  const fetchD1TableData = useCallback(async (table: string) => {
    if (!resource.provider_resource_id) return;
    setD1Loading(true);
    try {
      const res = await rpc.resources[':id'].d1.tables[':tableName'].$get({
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
  }, [resource]);

  const executeD1Query = useCallback(async () => {
    if (!resource.provider_resource_id || !d1Query.trim()) return;
    setD1Loading(true);
    try {
      const res = await rpc.resources[':id'].d1.query.$post({
        param: { id: resource.id },
        json: { sql: d1Query },
      });
      const result = await rpcJson<D1QueryResult>(res);
      setD1QueryResult(result);
    } catch (err: unknown) {
      setD1QueryResult({ error: getErrorMessage(err, 'Query failed') });
    } finally {
      setD1Loading(false);
    }
  }, [d1Query, resource]);

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
