import { useState, useEffect } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { useCustomTools } from '../../hooks/useCustomTools';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import type { CustomTool, Workspace } from '../../types';

interface CustomToolsSectionProps {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (id: string) => void;
}

export function CustomToolsSection({
  workspaces,
  selectedWorkspaceId,
  setSelectedWorkspaceId,
}: CustomToolsSectionProps) {
  const { t } = useI18n();
  const spaceId = selectedWorkspaceId || '';

  const {
    tools,
    loading,
    selectedTool,
    setSelectedTool,
    refresh,
    createTool,
    updateTool,
    deleteTool,
    toggleTool,
    executeTool,
  } = useCustomTools({ spaceId });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTool, setEditingTool] = useState<CustomTool | null>(null);
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [executeInput, setExecuteInput] = useState('{}');
  const [executeResult, setExecuteResult] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (spaceId) {
      refresh();
    }
  }, [spaceId, refresh]);

  const handleToggle = async (tool: CustomTool) => {
    await toggleTool(tool.id, !tool.enabled);
  };

  const handleExecute = async () => {
    if (!selectedTool) return;
    setExecuting(true);
    try {
      const input = JSON.parse(executeInput);
      const result = await executeTool(selectedTool.name, input);
      setExecuteResult(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } catch (error) {
      setExecuteResult(error instanceof Error ? error.message : t('executionFailed'));
    } finally {
      setExecuting(false);
    }
  };

  const openExecuteModal = (tool: CustomTool) => {
    setSelectedTool(tool);
    setExecuteInput('{}');
    setExecuteResult(null);
    setShowExecuteModal(true);
  };

  const openEditModal = (tool: CustomTool) => {
    setEditingTool(tool);
    setShowEditModal(true);
  };

  if (!selectedWorkspaceId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Wrench className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('selectWorkspace')}</p>
      </div>
    );
  }

  return (
    <>
      {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
            <span className="text-sm text-zinc-400">{t('loading')}</span>
          </div>
        ) : tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
              <Icons.Wrench className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('noCustomToolsYet')}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icons.Plus className="w-4 h-4" />}
              onClick={() => setShowCreateModal(true)}
            >
              {t('createFirstTool')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors"
                onClick={() => setShowCreateModal(true)}
              >
                <Icons.Plus className="w-4 h-4" />
                {t('addTool')}
              </button>
            </div>
            <div className="grid gap-3">
              {tools.map(tool => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  onToggle={() => handleToggle(tool)}
                  onEdit={() => openEditModal(tool)}
                  onExecute={() => openExecuteModal(tool)}
                  onDelete={() => deleteTool(tool.id, tool.name)}
                />
              ))}
            </div>
          </div>
        )}

      {showCreateModal && (
        <CreateToolModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (data) => {
            await createTool(data);
            setShowCreateModal(false);
          }}
        />
      )}

      {showEditModal && editingTool && (
        <EditToolModal
          tool={editingTool}
          onClose={() => {
            setShowEditModal(false);
            setEditingTool(null);
          }}
          onSave={async (data) => {
            const success = await updateTool(editingTool.id, data);
            if (success) {
              setShowEditModal(false);
              setEditingTool(null);
            }
          }}
        />
      )}

      {showExecuteModal && selectedTool && (
        <Modal
          isOpen
          onClose={() => setShowExecuteModal(false)}
          title={`${t('test')}: ${selectedTool.name}`}
        >
          <div className="flex flex-col gap-4">
            <div>
              <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('inputJson')}
              </label>
              <textarea
                value={executeInput}
                onChange={(e) => setExecuteInput(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
                placeholder="{}"
              />
            </div>

            <Button
              onClick={handleExecute}
              isLoading={executing}
              leftIcon={<Icons.Play className="w-4 h-4" />}
            >
              {t('execute')}
            </Button>

            {executeResult !== null && (
              <div>
                <label className="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t('result')}
                </label>
                <pre className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 overflow-auto max-h-[200px] text-xs font-mono whitespace-pre-wrap">
                  {executeResult}
                </pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

interface ToolCardProps {
  tool: CustomTool;
  onToggle: () => void;
  onEdit: () => void;
  onExecute: () => void;
  onDelete: () => void;
}

function ToolCard({ tool, onToggle, onEdit, onExecute, onDelete }: ToolCardProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-500">
        <Icons.Server className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {tool.name}
          </h4>
          {tool.takopackId && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
              {t('takopack')}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
          {tool.description}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title={tool.enabled ? t('disable') : t('enable')}
        >
          {tool.enabled ? (
            <ToggleOnIcon className="w-6 h-6 text-blue-500" />
          ) : (
            <ToggleOffIcon className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
          )}
        </button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onExecute}
          leftIcon={<Icons.Play className="w-4 h-4" />}
        >
          {t('test')}
        </Button>

        {!tool.takopackId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
          >
            <Icons.Edit className="w-4 h-4 text-zinc-400 hover:text-blue-500" />
          </Button>
        )}

        {!tool.takopackId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
          >
            <Icons.Trash className="w-4 h-4 text-zinc-400 hover:text-red-500" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface SchemaParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
}

function buildSchema(parameters: SchemaParameter[]): object {
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

function CreateToolModal({
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
  const [description, setDescription] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [creating, setCreating] = useState(false);
  const [parameters, setParameters] = useState<SchemaParameter[]>([]);
  const [showAddParam, setShowAddParam] = useState(false);

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

  const addParameter = (param: SchemaParameter) => {
    setParameters([...parameters, param]);
    setShowAddParam(false);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
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
          onAdd={() => setShowAddParam(true)}
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
          onClose={() => setShowAddParam(false)}
          onAdd={addParameter}
          existingNames={parameters.map(p => p.name)}
        />
      )}
    </Modal>
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

interface UpdateToolInput {
  description?: string;
  inputSchema?: object;
}

function EditToolModal({
  tool,
  onClose,
  onSave,
}: {
  tool: CustomTool;
  onClose: () => void;
  onSave: (data: UpdateToolInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState(tool.description);
  const [saving, setSaving] = useState(false);
  const [parameters, setParameters] = useState<SchemaParameter[]>(() => {
    const schema = tool.inputSchema as { properties?: Record<string, { type: string; description?: string }>; required?: string[] };
    if (!schema.properties) return [];

    return Object.entries(schema.properties).map(([name, prop]) => ({
      name,
      type: prop.type as SchemaParameter['type'],
      description: prop.description || '',
      required: schema.required?.includes(name) || false,
    }));
  });
  const [showAddParam, setShowAddParam] = useState(false);

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

  const addParameter = (param: SchemaParameter) => {
    setParameters([...parameters, param]);
    setShowAddParam(false);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
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
          onAdd={() => setShowAddParam(true)}
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
          onClose={() => setShowAddParam(false)}
          onAdd={addParameter}
          existingNames={parameters.map(p => p.name)}
        />
      )}
    </Modal>
  );
}

function ToggleOnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M7 6a5 5 0 0 0 0 10h10a5 5 0 0 0 0-10H7zm10 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" clipRule="evenodd" />
    </svg>
  );
}

function ToggleOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M7 6a5 5 0 0 0 0 10h10a5 5 0 0 0 0-10H7zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" clipRule="evenodd" />
    </svg>
  );
}
