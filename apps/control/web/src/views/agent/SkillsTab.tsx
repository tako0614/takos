import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../store/confirm-dialog';
import { rpc, rpcJson } from '../../lib/rpc';
import { getErrorMessage } from '../../lib/errors';
import { SkeletonList } from '../../components/Skeleton';
import type { OfficialSkill, Skill } from '../../types';
import { SkillList } from './SkillList';
import {
  SkillFormView,
  INITIAL_SKILL_FORM,
  buildSkillMetadata,
  splitCsv,
  readSkillMutationResponse,
  type SkillFormData,
} from './SkillForm';

export function SkillsTab({ spaceId }: { spaceId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [officialSkills, setOfficialSkills] = useState<OfficialSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [form, setForm] = useState<SkillFormData>(INITIAL_SKILL_FORM);
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
    } catch {
      setSkills([]);
      setOfficialSkills([]);
      showToast('error', t('failedToLoad') || 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm(INITIAL_SKILL_FORM);
    setError(null);
    setFieldErrors({});
  };

  const openCreateForm = () => {
    resetForm();
    setEditingSkill(null);
    setIsCreating(true);
  };

  const openEditForm = (skill: Skill) => {
    setForm({
      name: skill.name,
      description: skill.description || '',
      instructions: skill.instructions,
      triggers: skill.triggers.join(', '),
      skillLocale: skill.metadata?.locale || '',
      category: skill.metadata?.category || '',
      activationTags: (skill.metadata?.activation_tags || []).join(', '),
      preferredTools: (skill.metadata?.execution_contract?.preferred_tools || []).join(', '),
      durableOutputs: (skill.metadata?.execution_contract?.durable_output_hints || []).join(', '),
      outputModes: (skill.metadata?.execution_contract?.output_modes || []).join(', '),
      requiredMcpServers: (skill.metadata?.execution_contract?.required_mcp_servers || []).join(', '),
      templateIds: (skill.metadata?.execution_contract?.template_ids || []).join(', '),
    });
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
    if (!form.name.trim() || !form.instructions.trim()) return;

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const triggersArray = splitCsv(form.triggers);
    const metadata = buildSkillMetadata(form);

    try {
      if (editingSkill) {
        const res = await rpc.spaces[':spaceId'].skills.id[':skillId'].$put({
          param: { spaceId, skillId: editingSkill.id },
          json: {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            instructions: form.instructions.trim(),
            triggers: triggersArray,
            metadata,
          },
        });
        await readSkillMutationResponse(res);
      } else {
        const res = await rpc.spaces[':spaceId'].skills.$post({
          param: { spaceId },
          json: {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            instructions: form.instructions.trim(),
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
    } catch {
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
    } catch {
      showToast('error', t('skillToggleFailed') || 'Failed to update skill');
    }
  };

  if (loading) {
    return <SkeletonList count={3} />;
  }

  if (isCreating) {
    return (
      <SkillFormView
        form={form}
        setForm={setForm}
        isEditing={!!editingSkill}
        saving={saving}
        error={error}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onClose={closeForm}
      />
    );
  }

  return (
    <SkillList
      skills={skills}
      officialSkills={officialSkills}
      onEdit={openEditForm}
      onDelete={handleDelete}
      onToggle={handleToggle}
      onCreateNew={openCreateForm}
    />
  );
}
