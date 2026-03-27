import { type CSSProperties, type FormEvent } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { rpcJson } from '../../lib/rpc';
import { Button, Input, Textarea } from '../../components/ui';

export interface SkillFormData {
  name: string;
  description: string;
  instructions: string;
  triggers: string;
  skillLocale: string;
  category: string;
  activationTags: string;
  preferredTools: string;
  durableOutputs: string;
  outputModes: string;
  requiredMcpServers: string;
  templateIds: string;
}

export const INITIAL_SKILL_FORM: SkillFormData = {
  name: '',
  description: '',
  instructions: '',
  triggers: '',
  skillLocale: '',
  category: '',
  activationTags: '',
  preferredTools: '',
  durableOutputs: '',
  outputModes: '',
  requiredMcpServers: '',
  templateIds: '',
};

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildSkillMetadata(form: SkillFormData) {
  const metadata = {
    locale: form.skillLocale || undefined,
    category: form.category || undefined,
    activation_tags: splitCsv(form.activationTags),
    execution_contract: {
      preferred_tools: splitCsv(form.preferredTools),
      durable_output_hints: splitCsv(form.durableOutputs),
      output_modes: splitCsv(form.outputModes),
      required_mcp_servers: splitCsv(form.requiredMcpServers),
      template_ids: splitCsv(form.templateIds),
    },
  };

  const hasExecutionContract = Object.values(metadata.execution_contract).some((value) => value.length > 0);
  const hasMetadata = Boolean(
    metadata.locale
    || metadata.category
    || metadata.activation_tags.length > 0
    || hasExecutionContract
  );

  if (!hasMetadata) {
    return undefined;
  }

  return {
    ...(metadata.locale ? { locale: metadata.locale } : {}),
    ...(metadata.category ? { category: metadata.category } : {}),
    ...(metadata.activation_tags.length > 0 ? { activation_tags: metadata.activation_tags } : {}),
    ...(hasExecutionContract ? { execution_contract: metadata.execution_contract } : {}),
  };
}

export async function readSkillMutationResponse(response: Response) {
  if (response.ok) {
    return rpcJson(response);
  }

  const data = await response.json().catch(() => ({})) as {
    error?: string;
    details?: Record<string, string>;
  };
  const error = new Error(data.error || 'Failed to save skill') as Error & {
    details?: Record<string, string>;
  };
  if (data.details && typeof data.details === 'object') {
    error.details = data.details;
  }
  throw error;
}

const selectStyle: CSSProperties = {
  minHeight: '2.5rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-primary)',
  backgroundColor: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)',
  padding: '0.5rem 0.75rem',
};

function MetadataInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function SkillFormView({
  form,
  setForm,
  isEditing,
  saving,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: {
  form: SkillFormData;
  setForm: (form: SkillFormData) => void;
  isEditing: boolean;
  saving: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const updateField = <K extends keyof SkillFormData>(key: K, value: SkillFormData[K]) => {
    setForm({ ...form, [key]: value });
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} onSubmit={onSubmit}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <Icons.ArrowLeft />
        </Button>
        <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          {isEditing ? t('editSkill') : t('createSkill')}
        </h4>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillName')}</label>
        <Input
          placeholder={t('skillNamePlaceholder')}
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          autoFocus
          required
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillDescription')}</label>
        <Input
          placeholder={t('skillDescriptionPlaceholder')}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillInstructions')}</label>
        <Textarea
          placeholder={t('skillInstructionsPlaceholder')}
          value={form.instructions}
          onChange={(e) => updateField('instructions', e.target.value)}
          required
          rows={8}
          style={{ minHeight: '200px' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillTriggers')}</label>
        <Input
          placeholder={t('skillTriggersPlaceholder')}
          value={form.triggers}
          onChange={(e) => updateField('triggers', e.target.value)}
        />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{t('skillTriggersHint')}</span>
      </div>
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Locale</label>
          <select value={form.skillLocale} onChange={(e) => updateField('skillLocale', e.target.value)} style={selectStyle}>
            <option value="">auto</option>
            <option value="ja">ja</option>
            <option value="en">en</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Category</label>
          <select value={form.category} onChange={(e) => updateField('category', e.target.value)} style={selectStyle}>
            <option value="">unspecified</option>
            <option value="research">research</option>
            <option value="writing">writing</option>
            <option value="planning">planning</option>
            <option value="slides">slides</option>
            <option value="software">software</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <MetadataInput label="Activation Tags" value={form.activationTags} onChange={(v) => updateField('activationTags', v)} placeholder="slides, narrative" />
        <MetadataInput label="Preferred Tools" value={form.preferredTools} onChange={(v) => updateField('preferredTools', v)} placeholder="create_artifact, workspace_files_write" />
        <MetadataInput label="Durable Outputs" value={form.durableOutputs} onChange={(v) => updateField('durableOutputs', v)} placeholder="artifact, workspace_file" />
        <MetadataInput label="Output Modes" value={form.outputModes} onChange={(v) => updateField('outputModes', v)} placeholder="chat, artifact" />
        <MetadataInput label="Required MCP Servers" value={form.requiredMcpServers} onChange={(v) => updateField('requiredMcpServers', v)} placeholder="figma, notion" />
        <MetadataInput label="Template IDs" value={form.templateIds} onChange={(v) => updateField('templateIds', v)} placeholder="slides-outline, speaker-notes" />
      </div>
      {Object.keys(fieldErrors).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--color-error)' }}>
          {Object.entries(fieldErrors).map(([field, message]) => (
            <span key={field}>{field}: {message}</span>
          ))}
        </div>
      ) : null}
      {error && <div style={{ color: 'var(--color-error)', fontSize: '0.875rem' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" isLoading={saving} disabled={!form.name.trim() || !form.instructions.trim()}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
