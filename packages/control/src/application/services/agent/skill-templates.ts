export interface SkillTemplateDefinition {
  id: string;
  title: string;
  description: string;
}

const OFFICIAL_SKILL_TEMPLATES: SkillTemplateDefinition[] = [
  {
    id: 'research-brief',
    title: 'Research Brief',
    description: 'Short evidence-backed research brief structure.',
  },
  {
    id: 'writing-draft',
    title: 'Writing Draft',
    description: 'Reusable draft structure for messages, reports, and documents.',
  },
  {
    id: 'planning-structurer',
    title: 'Planning Structurer',
    description: 'Goal, constraints, phases, and next-step planning scaffold.',
  },
  {
    id: 'slides-outline',
    title: 'Slides Outline',
    description: 'Slide-by-slide narrative outline scaffold.',
  },
  {
    id: 'speaker-notes',
    title: 'Speaker Notes',
    description: 'Per-slide speaker note scaffold.',
  },
  {
    id: 'repo-app-bootstrap',
    title: 'Repo App Bootstrap',
    description: 'Repo-local app bootstrap scaffold.',
  },
  {
    id: 'api-worker',
    title: 'API Worker',
    description: 'Minimal API worker scaffold.',
  },
];

export function listSkillTemplates(): SkillTemplateDefinition[] {
  return OFFICIAL_SKILL_TEMPLATES.map((template) => ({ ...template }));
}

export function hasSkillTemplate(templateId: string): boolean {
  return OFFICIAL_SKILL_TEMPLATES.some((template) => template.id === templateId);
}
