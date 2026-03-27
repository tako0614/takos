import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Badge, Button, Card } from '../../components/ui';
import type { OfficialSkill, Skill } from '../../types';

function formatList(values?: string[]) {
  return values && values.length > 0 ? values.join(', ') : 'none';
}

function renderTriggers(triggersToRender: string[]) {
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
}

function renderExecutionContract(skill: Pick<OfficialSkill, 'execution_contract'>) {
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
}

function renderAvailability(skill: OfficialSkill) {
  return (
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
}

export function SkillList({
  skills,
  officialSkills,
  onEdit,
  onDelete,
  onToggle,
  onCreateNew,
}: {
  skills: Skill[];
  officialSkills: OfficialSkill[];
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onToggle: (skill: Skill) => void;
  onCreateNew: () => void;
}) {
  const { t, tOr } = useI18n();

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
              <Button variant="primary" leftIcon={<Icons.Plus style={{ width: '1rem', height: '1rem' }} />} onClick={onCreateNew}>
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
                        onClick={() => onToggle(skill)}
                        title={skill.enabled ? t('skillEnabled') : t('skillDisabled')}
                      >
                        {skill.enabled ? <Icons.Check /> : <Icons.X />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(skill)}
                        title={t('edit')}
                      >
                        <Icons.Edit />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(skill)}
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
        onClick={onCreateNew}
        style={{ width: '100%', marginTop: '1rem', border: '2px dashed var(--color-border-primary)' }}
      >
        {t('addSkill')}
      </Button>
    </>
  );
}
