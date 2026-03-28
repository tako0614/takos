import { useState, useCallback } from 'react';
import type { SchemaParameter } from '../views/hub/ToolModals';

interface InputSchema {
  properties?: Record<string, { type: string; description?: string }>;
  required?: string[];
}

function parseSchemaParameters(schema?: InputSchema): SchemaParameter[] {
  if (!schema?.properties) return [];

  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: prop.type as SchemaParameter['type'],
    description: prop.description || '',
    required: schema.required?.includes(name) || false,
  }));
}

interface UseToolFormOptions {
  initialDescription?: string;
  initialSchema?: InputSchema;
}

export function useToolForm(options: UseToolFormOptions = {}) {
  const [description, setDescription] = useState(options.initialDescription ?? '');
  const [parameters, setParameters] = useState<SchemaParameter[]>(() =>
    parseSchemaParameters(options.initialSchema),
  );
  const [showAddParam, setShowAddParam] = useState(false);

  const addParameter = useCallback((param: SchemaParameter) => {
    setParameters((prev) => [...prev, param]);
    setShowAddParam(false);
  }, []);

  const removeParameter = useCallback((index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const openAddParam = useCallback(() => setShowAddParam(true), []);
  const closeAddParam = useCallback(() => setShowAddParam(false), []);

  const reset = useCallback(() => {
    setDescription(options.initialDescription ?? '');
    setParameters(parseSchemaParameters(options.initialSchema));
    setShowAddParam(false);
  }, [options.initialDescription, options.initialSchema]);

  const parameterNames = parameters.map((p) => p.name);

  return {
    description,
    setDescription,
    parameters,
    showAddParam,
    addParameter,
    removeParameter,
    openAddParam,
    closeAddParam,
    parameterNames,
    reset,
  };
}
