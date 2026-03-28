import { useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { useToolForm } from '../../hooks/useToolForm';
import type { CustomTool } from '../../types';

export interface SchemaParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
}

export function buildSchema(parameters: SchemaParameter[]): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const param of parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

interface ParameterListProps {
  parameters: SchemaParameter[];
  onRemove: (index: number) => void;
  onAdd: () => void;
}

function ParameterList({ parameters, onRemove, onAdd }: ParameterListProps) {
  const { t } = useI18n();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('inputParameters')} ({parameters.length})
        </label>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Icons.Plus className="w-4 h-4" />
        </Button>
      </div>

      {parameters.length === 0 ? (
        <div className="p-3 text-center text-sm text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-xl">
          {t('noParametersDefined')}
        </div>
      ) : (
        <div className="space-y-2 max-h-[150px] overflow-y-auto">
          {parameters.map((param, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {param.name}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded">
                    {param.type}
                  </span>
                  {param.required && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                      {t('requiredField')}
                    </span>
                  )}
                </div>
                {param.description && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                    {param.description}
                  </p>
                )}
              </div>
              <button
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500"
                onClick={() => onRemove(index)}
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddParameterModal({
  onClose,
  onAdd,
  existingNames,
}: {
  onClose: () => void;
  onAdd: (param: SchemaParameter) => void;
  existingNames: string[];
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [paramType, setParamType] = useState<SchemaParameter['type']>('string');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(false);

  const isValid = name.trim() && !existingNames.includes(name.trim());

  const handleAdd = () => {
    onAdd({
      name: name.trim(),
      type: paramType,
      description: description.trim(),
      required,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          {t('addParameter')}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t('name')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="parameter_name"
            />
            {existingNames.includes(name.trim()) && (
              <p className="text-xs text-red-500 mt-1">{t('nameAlreadyExists')}</p>
            )}
          </div>

          <div>
            <label className="block mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t('toolType')}
            </label>
            <select
              value={paramType}
              onChange={(e) => setParamType(e.target.value as SchemaParameter['type'])}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="array">array</option>
              <option value="object">object</option>
            </select>
          </div>

          <div>
            <label className="block mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t('description')}
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('parameterDescriptionPlaceholder')}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{t('requiredField')}</span>
          </label>
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={handleAdd} disabled={!isValid}>
            {t('add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface UpdateToolInput {
  description?: string;
  inputSchema?: object;
}

export function CreateToolModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description: string;
    inputSchema: object;
    workerId: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [creating, setCreating] = useState(false);

  const {
    description,
    setDescription,
    parameters,
    showAddParam,
    addParameter,
    removeParameter,
    openAddParam,
    closeAddParam,
    parameterNames,
  } = useToolForm();

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreate({
        name,
        description,
        inputSchema: buildSchema(parameters),
        workerId,
      });
    } finally {
      setCreating(false);
    }
  };

  const isValid = name.trim() && description.trim() && workerId.trim();

  return (
    <Modal isOpen onClose={onClose} title={t('createCustomTool')} size="md">
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('toolNameSnakeCase')}
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_tool"
          />
        </div>

        <div>
          <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('description')}
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('toolDescriptionPlaceholder')}
          />
        </div>

        <div>
          <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('workerId')}
          </label>
          <Input
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            placeholder="worker-id"
          />
        </div>

        <ParameterList
          parameters={parameters}
          onRemove={removeParameter}
          onAdd={openAddParam}
        />

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!isValid}
            isLoading={creating}
          >
            {t('create')}
          </Button>
        </div>
      </div>

      {showAddParam && (
        <AddParameterModal
          onClose={closeAddParam}
          onAdd={addParameter}
          existingNames={parameterNames}
        />
      )}
    </Modal>
  );
}

export function EditToolModal({
  tool,
  onClose,
  onSave,
}: {
  tool: CustomTool;
  onClose: () => void;
  onSave: (data: UpdateToolInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  const {
    description,
    setDescription,
    parameters,
    showAddParam,
    addParameter,
    removeParameter,
    openAddParam,
    closeAddParam,
    parameterNames,
  } = useToolForm({
    initialDescription: tool.description,
    initialSchema: tool.inputSchema as { properties?: Record<string, { type: string; description?: string }>; required?: string[] },
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: UpdateToolInput = {
        description,
        inputSchema: buildSchema(parameters),
      };

      await onSave(data);
    } finally {
      setSaving(false);
    }
  };

  const isValid = description.trim();

  return (
    <Modal isOpen onClose={onClose} title={`${t('editTool')}: ${tool.name}`} size="md">
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('nameCannotBeChanged')}
          </label>
          <Input
            value={tool.name}
            disabled
            className="opacity-60 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('description')}
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('toolDescriptionPlaceholder')}
          />
        </div>

        <div>
          <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('workerIdCannotBeChanged')}
          </label>
          <Input
            value={tool.workerId || ''}
            disabled
            className="opacity-60 cursor-not-allowed"
          />
        </div>

        <ParameterList
          parameters={parameters}
          onRemove={removeParameter}
          onAdd={openAddParam}
        />

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isValid}
            isLoading={saving}
          >
            {t('saveChanges')}
          </Button>
        </div>
      </div>

      {showAddParam && (
        <AddParameterModal
          onClose={closeAddParam}
          onAdd={addParameter}
          existingNames={parameterNames}
        />
      )}
    </Modal>
  );
}
