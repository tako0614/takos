import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../providers/ConfirmDialogProvider';
import { rpc, rpcJson } from '../../lib/rpc';
import { getErrorMessage } from '../../lib/errors';
import { Icons } from '../../lib/Icons';
import { SkeletonList } from '../../components/Skeleton';
import { Badge, Button, Card, Input, Textarea } from '../../components/ui';
import type { OfficialSkill, Skill } from '../../types';

export function SkillsTab({ spaceId }: { spaceId: string }) {
  const { t, tOr } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [officialSkills, setOfficialSkills] = useState<OfficialSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [triggers, setTriggers] = useState('');
  const [skillLocale, setSkillLocale] = useState('');
  const [category, setCategory] = useState('');
  const [activationTags, setActivationTags] = useState('');
  const [preferredTools, setPreferredTools] = useState('');
  const [durableOutputs, setDurableOutputs] = useState('');
  const [outputModes, setOutputModes] = useState('');
  const [requiredMcpServers, setRequiredMcpServers] = useState('');
  const [templateIds, setTemplateIds] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchSkills();
  }, [spaceId]);

  const fetchSkills = async () => {
    setLoading(true);
    try {
      const [customRes, officialRes] = await Promise.all([
        rpc.spaces[':spaceId'].skills.$get({
          param: { spaceId },
        }),
        rpc.spaces[':spaceId']['official-skills'].$get({
          param: { spaceId },
        }),
      ]);
      const customData = await rpcJson<{ skills: Skill[] }>(customRes);
      const officialData = await rpcJson<{ skills: OfficialSkill[] }>(officialRes);
      setSkills(customData.skills || []);
      setOfficialSkills(officialData.skills || []);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
      setSkills([]);
      setOfficialSkills([]);
      showToast('error', t('failedToLoad') || 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setInstructions('');
    setTriggers('');
    setSkillLocale('');
    setCategory('');
    setActivationTags('');
    setPreferredTools('');
    setDurableOutputs('');
    setOutputModes('');
    setRequiredMcpServers('');
    setTemplateIds('');
    setError(null);
    setFieldErrors({});
  };

  const openCreateForm = () => {
    resetForm();
    setEditingSkill(null);
    setIsCreating(true);
  };

  const openEditForm = (skill: Skill) => {
    setName(skill.name);
    setDescription(skill.description || '');
    setInstructions(skill.instructions);
    setTriggers(skill.triggers.join(', '));
    setSkillLocale(skill.metadata?.locale || '');
    setCategory(skill.metadata?.category || '');
    setActivationTags((skill.metadata?.activation_tags || []).join(', '));
    setPreferredTools((skill.metadata?.execution_contract?.preferred_tools || []).join(', '));
    setDurableOutputs((skill.metadata?.execution_contract?.durable_output_hints || []).join(', '));
    setOutputModes((skill.metadata?.execution_contract?.output_modes || []).join(', '));
    setRequiredMcpServers((skill.metadata?.execution_contract?.required_mcp_servers || []).join(', '));
    setTemplateIds((skill.metadata?.execution_contract?.template_ids || []).join(', '));
    setError(null);
    setFieldErrors({});
    setEditingSkill(skill);
    setIsCreating(true);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingSkill(null);
    resetForm();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !instructions.trim()) return;

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const triggersArray = triggers
      .split(',')
      .map((tr) => tr.trim())
      .filter(Boolean);
    const metadata = buildSkillMetadata({
      skillLocale,
      category,
      activationTags,
      preferredTools,
      durableOutputs,
      outputModes,
      requiredMcpServers,
      templateIds,
    });

    try {
      if (editingSkill) {
        const res = await rpc.spaces[':spaceId'].skills.id[':skillId'].$put({
          param: { spaceId, skillId: editingSkill.id },
          json: {
            name: name.trim(),
            description: description.trim() || undefined,
            instructions: instructions.trim(),
            triggers: triggersArray,
            metadata,
          },
        });
        await readSkillMutationResponse(res);
      } else {
        const res = await rpc.spaces[':spaceId'].skills.$post({
          param: { spaceId },
          json: {
            name: name.trim(),
            description: description.trim() || undefined,
            instructions: instructions.trim(),
            triggers: triggersArray,
            metadata,
          },
        });
        await readSkillMutationResponse(res);
      }
      closeForm();
      await fetchSkills();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'details' in err) {
        const details = (err as { details?: Record<string, string> }).details;
        if (details && typeof details === 'object') {
          setFieldErrors(details);
        }
      }
      setError(getErrorMessage(err, 'Failed to save skill'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skill: Skill) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('confirmDeleteSkill'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[':spaceId'].skills.id[':skillId'].$delete({
        param: { spaceId, skillId: skill.id },
      });
      await rpcJson(res);
      await fetchSkills();
    } catch (err) {
      console.error('Failed to delete skill:', err);
      showToast('error', t('deleteSkillFailed') || 'Failed to delete skill');
    }
  };

  const handleToggle = async (skill: Skill) => {
    try {
      const res = await rpc.spaces[':spaceId'].skills.id[':skillId'].$patch({
        param: { spaceId, skillId: skill.id },
        json: { enabled: !skill.enabled },
      });
      await rpcJson(res);
      await fetchSkills();
    } catch (err) {
      console.error('Failed to toggle skill:', err);
      showToast('error', t('skillToggleFailed') || 'Failed to update skill');
    }
  };

  const renderTriggers = (triggersToRender: string[]) => {
    if (triggersToRender.length === 0) {
      return null;
    }

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
        {triggersToRender.map((trigger, i) => (
          <Badge key={i} variant="default">
            {trigger}
          </Badge>
        ))}
      </div>
    );
  };

  const renderExecutionContract = (skill: Pick<OfficialSkill, 'execution_contract'>) => {
    const contract = skill.execution_contract;
    if (!contract) {
      return null;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
        <span>tools: {formatList(contract.preferred_tools)}</span>
        <span>outputs: {formatList(contract.durable_output_hints)}</span>
        <span>modes: {formatList(contract.output_modes)}</span>
        <span>mcp: {formatList(contract.required_mcp_servers)}</span>
        <span>templates: {formatList(contract.template_ids)}</span>
      </div>
    );
  };

  const renderAvailability = (skill: OfficialSkill) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {skill.version ? <Badge variant="default">v{skill.version}</Badge> : null}
        {skill.availability ? <Badge variant="default">{skill.availability}</Badge> : null}
      </div>
      {skill.availability_reasons && skill.availability_reasons.length > 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
          {skill.availability_reasons.join(' / ')}
        </div>
      ) : null}
    </div>
  );

  if (loading) {
    return <SkeletonList count={3} />;
  }

  if (isCreating) {
    return (
      <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Button type="button" variant="ghost" size="sm" onClick={closeForm}>
            <Icons.ArrowLeft />
          </Button>
          <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
            {editingSkill ? t('editSkill') : t('createSkill')}
          </h4>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillName')}</label>
          <Input
            placeholder={t('skillNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillDescription')}</label>
          <Input
            placeholder={t('skillDescriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillInstructions')}</label>
          <Textarea
            placeholder={t('skillInstructionsPlaceholder')}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            rows={8}
            style={{ minHeight: '200px' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('skillTriggers')}</label>
          <Input
            placeholder={t('skillTriggersPlaceholder')}
            value={triggers}
            onChange={(e) => setTriggers(e.target.value)}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{t('skillTriggersHint')}</span>
        </div>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Locale</label>
            <select value={skillLocale} onChange={(e) => setSkillLocale(e.target.value)} style={selectStyle}>
              <option value="">auto</option>
              <option value="ja">ja</option>
              <option value="en">en</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
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
          <MetadataInput label="Activation Tags" value={activationTags} onChange={setActivationTags} placeholder="slides, narrative" />
          <MetadataInput label="Preferred Tools" value={preferredTools} onChange={setPreferredTools} placeholder="create_artifact, workspace_files_write" />
          <MetadataInput label="Durable Outputs" value={durableOutputs} onChange={setDurableOutputs} placeholder="artifact, workspace_file" />
          <MetadataInput label="Output Modes" value={outputModes} onChange={setOutputModes} placeholder="chat, artifact" />
          <MetadataInput label="Required MCP Servers" value={requiredMcpServers} onChange={setRequiredMcpServers} placeholder="figma, notion" />
          <MetadataInput label="Template IDs" value={templateIds} onChange={setTemplateIds} placeholder="slides-outline, speaker-notes" />
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
          <Button type="button" variant="secondary" onClick={closeForm}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" isLoading={saving} disabled={!name.trim() || !instructions.trim()}>
            {t('save')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              {tOr('officialSkills', 'Official Skills')}
            </h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem', marginBottom: 0 }}>
              {tOr('officialSkillsHint', 'Built-in read-only skills that ship with the Takos agent')}
            </p>
          </div>
          {officialSkills.map((skill) => (
            <Card key={skill.id} padding="md">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-primary)', flexShrink: 0 }}>
                  <Icons.Sparkles />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <h4 style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{skill.name}</h4>
                    <Badge variant="default">official</Badge>
                    <Badge variant="default">{skill.category}</Badge>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem', marginBottom: 0 }}>
                    {skill.description}
                  </p>
                  {renderAvailability(skill)}
                  {renderExecutionContract(skill)}
                </div>
              </div>
              {renderTriggers(skill.triggers)}
            </Card>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
            {tOr('customSkills', 'Custom Skills')}
          </h4>
          {skills.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)', gap: '1rem' }}>
              <div style={{ width: '4rem', height: '4rem', borderRadius: '50%', backgroundColor: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-primary)' }}>
                <Icons.Sparkles style={{ width: '2rem', height: '2rem' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{t('noSkills')}</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                  {tOr('skillsEmptyHint', 'Create custom skills to extend your agent\'s capabilities')}
                </p>
              </div>
              <Button variant="primary" leftIcon={<Icons.Plus style={{ width: '1rem', height: '1rem' }} />} onClick={openCreateForm}>
                {t('addSkill')}
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {skills.map((skill) => (
                <Card key={skill.name} padding="md" style={{ opacity: skill.enabled ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-primary)', flexShrink: 0 }}>
                      <Icons.Code />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{skill.name}</h4>
                      {skill.description && (
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{skill.description}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                      <Button
                        variant={skill.enabled ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => handleToggle(skill)}
                        title={skill.enabled ? t('skillEnabled') : t('skillDisabled')}
                      >
                        {skill.enabled ? <Icons.Check /> : <Icons.X />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditForm(skill)}
                        title={t('edit')}
                      >
                        <Icons.Edit />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(skill)}
                        title={t('deleteSkill')}
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        <Icons.Trash />
                      </Button>
                    </div>
                  </div>
                  {renderTriggers(skill.triggers)}
                  {skill.metadata ? (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                      {skill.metadata.locale ? <Badge variant="default">{skill.metadata.locale}</Badge> : null}
                      {skill.metadata.category ? <Badge variant="default">{skill.metadata.category}</Badge> : null}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
      <Button
        variant="secondary"
        leftIcon={<Icons.Plus />}
        onClick={openCreateForm}
        style={{ width: '100%', marginTop: '1rem', border: '2px dashed var(--color-border-primary)' }}
      >
        {t('addSkill')}
      </Button>
    </>
  );
}

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

const selectStyle: CSSProperties = {
  minHeight: '2.5rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-primary)',
  backgroundColor: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)',
  padding: '0.5rem 0.75rem',
};

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSkillMetadata(input: {
  skillLocale: string;
  category: string;
  activationTags: string;
  preferredTools: string;
  durableOutputs: string;
  outputModes: string;
  requiredMcpServers: string;
  templateIds: string;
}) {
  const metadata = {
    locale: input.skillLocale || undefined,
    category: input.category || undefined,
    activation_tags: splitCsv(input.activationTags),
    execution_contract: {
      preferred_tools: splitCsv(input.preferredTools),
      durable_output_hints: splitCsv(input.durableOutputs),
      output_modes: splitCsv(input.outputModes),
      required_mcp_servers: splitCsv(input.requiredMcpServers),
      template_ids: splitCsv(input.templateIds),
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

function formatList(values?: string[]) {
  return values && values.length > 0 ? values.join(', ') : 'none';
}

async function readSkillMutationResponse(response: Response) {
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
