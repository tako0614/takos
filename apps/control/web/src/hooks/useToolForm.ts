import { createSignal, createMemo } from 'solid-js';
import type { SchemaParameter } from '../views/hub/ToolModals.tsx';

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
  const [description, setDescription] = createSignal(options.initialDescription ?? '');
  const [parameters, setParameters] = createSignal<SchemaParameter[]>(
    parseSchemaParameters(options.initialSchema),
  );
  const [showAddParam, setShowAddParam] = createSignal(false);

  const addParameter = (param: SchemaParameter) => {
    setParameters((prev) => [...prev, param]);
    setShowAddParam(false);
  };

  const removeParameter = (index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  };

  const openAddParam = () => setShowAddParam(true);
  const closeAddParam = () => setShowAddParam(false);

  const reset = () => {
    setDescription(options.initialDescription ?? '');
    setParameters(parseSchemaParameters(options.initialSchema));
    setShowAddParam(false);
  };

  const parameterNames = createMemo(() => parameters().map((p) => p.name));

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
