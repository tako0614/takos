import type {
  CustomSkillMetadata,
  DurableOutputHint,
  OfficialSkillCategory,
  SkillExecutionContract,
  SkillLocale,
  SkillOutputMode,
} from './skill-contracts.ts';
import {
  planningStructurerEnMarkdown,
  planningStructurerJaMarkdown,
  repoAppOperatorEnMarkdown,
  repoAppOperatorJaMarkdown,
  researchBriefEnMarkdown,
  researchBriefJaMarkdown,
  slidesAuthorEnMarkdown,
  slidesAuthorJaMarkdown,
  writingDraftEnMarkdown,
  writingDraftJaMarkdown,
} from './prompt-assets.generated.ts';

interface OfficialSkillLocaleContent {
  name: string;
  description: string;
  instructions: string;
  triggers: string[];
}

export interface OfficialSkillDefinition {
  id: string;
  version: string;
  category: OfficialSkillCategory;
  priority: number;
  activation_tags: string[];
  execution_contract: SkillExecutionContract;
  locales: Record<SkillLocale, OfficialSkillLocaleContent>;
}

export interface LocalizedOfficialSkill {
  id: string;
  version: string;
  locale: SkillLocale;
  category: OfficialSkillCategory;
  priority: number;
  activation_tags: string[];
  execution_contract: SkillExecutionContract;
  name: string;
  description: string;
  instructions: string;
  triggers: string[];
}

const OFFICIAL_SKILLS: OfficialSkillDefinition[] = [
  {
    id: 'research-brief',
    version: '1.0.0',
    category: 'research',
    priority: 100,
    activation_tags: ['research', 'summary', 'evidence', 'comparison'],
    execution_contract: {
      preferred_tools: ['browser_open', 'browser_goto', 'browser_extract', 'browser_screenshot', 'web_fetch', 'search', 'create_artifact'],
      durable_output_hints: ['artifact'],
      output_modes: ['chat', 'artifact'],
      required_mcp_servers: [],
      template_ids: ['research-brief'],
    },
    locales: {
      ja: {
        name: '調査ブリーフ',
        description: 'トピックを調査し、根拠を比較しながら要点を整理して返す。',
        instructions: researchBriefJaMarkdown.trim(),
        triggers: ['調査', 'リサーチ', '要約', '比較', '根拠', '出典', 'ファクトチェック', '分析'],
      },
      en: {
        name: 'Research Brief',
        description: 'Investigate a topic, gather evidence, compare sources, and summarize the result clearly.',
        instructions: researchBriefEnMarkdown.trim(),
        triggers: ['research', 'investigate', 'analyze', 'compare', 'summarize', 'sources', 'fact check'],
      },
    },
  },
  {
    id: 'writing-draft',
    version: '1.0.0',
    category: 'writing',
    priority: 90,
    activation_tags: ['writing', 'draft', 'rewrite', 'communication'],
    execution_contract: {
      preferred_tools: ['create_artifact'],
      durable_output_hints: ['artifact'],
      output_modes: ['chat', 'artifact'],
      required_mcp_servers: [],
      template_ids: ['writing-draft'],
    },
    locales: {
      ja: {
        name: '文章ドラフト',
        description: 'ラフな意図を文書、メール、レポート、投稿文の形に落とし込む。',
        instructions: writingDraftJaMarkdown.trim(),
        triggers: ['文章', 'ドラフト', '下書き', '書いて', '書き直し', 'メール', 'レポート', '記事', '投稿'],
      },
      en: {
        name: 'Writing Draft',
        description: 'Turn rough intent into a draft, rewrite, report, email, or polished written output.',
        instructions: writingDraftEnMarkdown.trim(),
        triggers: ['write', 'draft', 'rewrite', 'email', 'post', 'article', 'copy', 'document'],
      },
    },
  },
  {
    id: 'planning-structurer',
    version: '1.0.0',
    category: 'planning',
    priority: 80,
    activation_tags: ['plan', 'roadmap', 'milestone', 'organization'],
    execution_contract: {
      preferred_tools: ['create_artifact', 'set_reminder', 'recall'],
      durable_output_hints: ['artifact', 'reminder'],
      output_modes: ['chat', 'artifact', 'reminder'],
      required_mcp_servers: [],
      template_ids: ['planning-structurer'],
    },
    locales: {
      ja: {
        name: '計画ストラクチャ',
        description: '目標、制約、マイルストーン、次の一手を整理して実行可能な形にする。',
        instructions: planningStructurerJaMarkdown.trim(),
        triggers: ['計画', 'プラン', 'ロードマップ', 'マイルストーン', '段取り', '整理', '次の一手', '進め方'],
      },
      en: {
        name: 'Planning Structurer',
        description: 'Clarify goals, scope, milestones, and next steps for a project or task.',
        instructions: planningStructurerEnMarkdown.trim(),
        triggers: ['plan', 'roadmap', 'milestone', 'schedule', 'break down', 'organize', 'next steps'],
      },
    },
  },
  {
    id: 'slides-author',
    version: '1.0.0',
    category: 'slides',
    priority: 95,
    activation_tags: ['slides', 'presentation', 'deck', 'narrative'],
    execution_contract: {
      preferred_tools: ['create_artifact', 'workspace_files_write'],
      durable_output_hints: ['artifact', 'workspace_file'],
      output_modes: ['chat', 'artifact', 'workspace_file'],
      required_mcp_servers: [],
      template_ids: ['slides-outline', 'speaker-notes'],
    },
    locales: {
      ja: {
        name: 'スライド作成',
        description: 'プレゼン資料の構成、各スライドの内容、話す流れを組み立てる。',
        instructions: slidesAuthorJaMarkdown.trim(),
        triggers: ['スライド', '資料', 'プレゼン', '発表', 'デッキ', 'PPTX', 'パワポ'],
      },
      en: {
        name: 'Slides Author',
        description: 'Design slide decks, presentation structures, and speaking outlines.',
        instructions: slidesAuthorEnMarkdown.trim(),
        triggers: ['slides', 'slide deck', 'presentation', 'pptx', 'powerpoint', 'keynote'],
      },
    },
  },
  {
    id: 'repo-app-operator',
    version: '1.0.0',
    category: 'software',
    priority: 110,
    activation_tags: ['repo', 'software', 'deploy', 'app', 'automation'],
    execution_contract: {
      preferred_tools: [
        'store_search',
        'repo_fork',
        'create_repository',
        'container_start',
        'runtime_exec',
        'container_commit',
        'app_deployment_deploy_from_repo',
      ],
      durable_output_hints: ['repo', 'app', 'artifact'],
      output_modes: ['chat', 'repo', 'app', 'artifact'],
      required_mcp_servers: [],
      template_ids: ['repo-app-bootstrap', 'api-worker'],
    },
    locales: {
      ja: {
        name: 'リポジトリ/アプリ運用',
        description: 'ソフトウェア資産を repo と app として取得・作成・変更・公開する。',
        instructions: repoAppOperatorJaMarkdown.trim(),
        triggers: ['リポジトリ', 'repo', 'API', 'アプリ', 'デプロイ', 'worker', 'ツール', '自動化', 'サービス', 'エンドポイント'],
      },
      en: {
        name: 'Repo App Operator',
        description: 'Acquire, create, modify, and deploy software assets as repos and apps on Takos.',
        instructions: repoAppOperatorEnMarkdown.trim(),
        triggers: ['repo', 'repository', 'deploy', 'app', 'api', 'worker', 'tool', 'automation', 'service', 'endpoint'],
      },
    },
  },
];

export const CATEGORY_LABELS: Record<OfficialSkillCategory | 'custom', { label: string; description: string }> = {
  research: { label: 'Research', description: 'Investigate topics, gather evidence, and summarize findings.' },
  writing: { label: 'Writing', description: 'Draft, rewrite, and polish written content.' },
  planning: { label: 'Planning', description: 'Organize goals, milestones, and next steps.' },
  slides: { label: 'Slides', description: 'Design slide decks and presentation structures.' },
  software: { label: 'Software', description: 'Build, deploy, and manage software assets.' },
  custom: { label: 'Custom', description: 'Workspace custom skills.' },
};

export function getCategoryLabel(cat: OfficialSkillCategory | 'custom'): { label: string; description: string } {
  return CATEGORY_LABELS[cat] ?? CATEGORY_LABELS.custom;
}

const JAPANESE_TEXT_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
const VALID_OUTPUT_MODES: SkillOutputMode[] = ['chat', 'artifact', 'reminder', 'repo', 'app', 'workspace_file'];
const VALID_DURABLE_OUTPUT_HINTS: DurableOutputHint[] = ['artifact', 'reminder', 'repo', 'app', 'workspace_file'];
const VALID_CATEGORIES: OfficialSkillCategory[] = ['research', 'writing', 'planning', 'slides', 'software'];

export interface CustomSkillMetadataValidationResult {
  normalized: CustomSkillMetadata;
  fieldErrors: Record<string, string>;
}

export function isSkillLocale(value: string | undefined | null): value is SkillLocale {
  return value === 'ja' || value === 'en';
}

export function resolveSkillLocale(input?: {
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
  textSamples?: string[];
}): SkillLocale {
  if (isSkillLocale(input?.preferredLocale)) {
    return input.preferredLocale;
  }

  const normalizedAcceptLanguage = String(input?.acceptLanguage || '').toLowerCase();
  if (normalizedAcceptLanguage.startsWith('ja')) {
    return 'ja';
  }
  if (normalizedAcceptLanguage.startsWith('en')) {
    return 'en';
  }

  const combinedSamples = (input?.textSamples ?? []).join('\n');
  if (JAPANESE_TEXT_RE.test(combinedSamples)) {
    return 'ja';
  }

  return 'en';
}

function cloneExecutionContract(contract: SkillExecutionContract): SkillExecutionContract {
  return {
    preferred_tools: [...contract.preferred_tools],
    durable_output_hints: [...contract.durable_output_hints],
    output_modes: [...contract.output_modes],
    required_mcp_servers: [...contract.required_mcp_servers],
    template_ids: [...contract.template_ids],
  };
}

export function normalizeCustomSkillMetadata(input: unknown): CustomSkillMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const raw = input as Record<string, unknown>;
  const activationTags = Array.isArray(raw.activation_tags)
    ? raw.activation_tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];

  const executionRaw =
    raw.execution_contract && typeof raw.execution_contract === 'object' && !Array.isArray(raw.execution_contract)
      ? raw.execution_contract as Record<string, unknown>
      : {};

  const preferredTools = Array.isArray(executionRaw.preferred_tools)
    ? executionRaw.preferred_tools.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];
  const durableOutputs = Array.isArray(executionRaw.durable_output_hints)
    ? executionRaw.durable_output_hints
      .map((item) => String(item).trim())
      .filter((item): item is DurableOutputHint => VALID_DURABLE_OUTPUT_HINTS.includes(item as DurableOutputHint))
      .slice(0, 10)
    : [];
  const outputModes = Array.isArray(executionRaw.output_modes)
    ? executionRaw.output_modes
      .map((item) => String(item).trim())
      .filter((item): item is SkillOutputMode => VALID_OUTPUT_MODES.includes(item as SkillOutputMode))
      .slice(0, 10)
    : [];
  const requiredMcpServers = Array.isArray(executionRaw.required_mcp_servers)
    ? executionRaw.required_mcp_servers.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];
  const templateIds = Array.isArray(executionRaw.template_ids)
    ? executionRaw.template_ids.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];

  return {
    locale: isSkillLocale(typeof raw.locale === 'string' ? raw.locale : null)
      ? raw.locale as SkillLocale
      : undefined,
    category:
      typeof raw.category === 'string' && VALID_CATEGORIES.includes(raw.category as OfficialSkillCategory)
        ? raw.category as OfficialSkillCategory
        : undefined,
    activation_tags: activationTags,
    execution_contract: {
      preferred_tools: preferredTools,
      durable_output_hints: durableOutputs,
      output_modes: outputModes,
      required_mcp_servers: requiredMcpServers,
      template_ids: templateIds,
    },
  };
}

export function validateCustomSkillMetadata(input: unknown): CustomSkillMetadataValidationResult {
  const fieldErrors: Record<string, string> = {};

  if (input && (typeof input !== 'object' || Array.isArray(input))) {
    fieldErrors.metadata = 'metadata must be an object';
    return { normalized: {}, fieldErrors };
  }

  const raw = (input ?? {}) as Record<string, unknown>;

  if (raw.locale !== undefined && !isSkillLocale(typeof raw.locale === 'string' ? raw.locale : null)) {
    fieldErrors.locale = 'locale must be ja or en';
  }

  if (
    raw.category !== undefined &&
    (typeof raw.category !== 'string' || !VALID_CATEGORIES.includes(raw.category as OfficialSkillCategory))
  ) {
    fieldErrors.category = 'category must be one of research, writing, planning, slides, software';
  }

  if (raw.activation_tags !== undefined && !Array.isArray(raw.activation_tags)) {
    fieldErrors.activation_tags = 'activation_tags must be an array of strings';
  }

  const executionRaw =
    raw.execution_contract && typeof raw.execution_contract === 'object' && !Array.isArray(raw.execution_contract)
      ? raw.execution_contract as Record<string, unknown>
      : raw.execution_contract === undefined
        ? null
        : 'invalid';

  if (executionRaw === 'invalid') {
    fieldErrors.execution_contract = 'execution_contract must be an object';
  } else if (executionRaw) {
    if (executionRaw.preferred_tools !== undefined && !Array.isArray(executionRaw.preferred_tools)) {
      fieldErrors['execution_contract.preferred_tools'] = 'preferred_tools must be an array of strings';
    }
    if (
      executionRaw.durable_output_hints !== undefined &&
      (!Array.isArray(executionRaw.durable_output_hints) ||
        executionRaw.durable_output_hints.some((item) => !VALID_DURABLE_OUTPUT_HINTS.includes(String(item).trim() as DurableOutputHint)))
    ) {
      fieldErrors['execution_contract.durable_output_hints'] = 'durable_output_hints contains an invalid value';
    }
    if (
      executionRaw.output_modes !== undefined &&
      (!Array.isArray(executionRaw.output_modes) ||
        executionRaw.output_modes.some((item) => !VALID_OUTPUT_MODES.includes(String(item).trim() as SkillOutputMode)))
    ) {
      fieldErrors['execution_contract.output_modes'] = 'output_modes contains an invalid value';
    }
    if (executionRaw.required_mcp_servers !== undefined && !Array.isArray(executionRaw.required_mcp_servers)) {
      fieldErrors['execution_contract.required_mcp_servers'] = 'required_mcp_servers must be an array of strings';
    }
    if (executionRaw.template_ids !== undefined && !Array.isArray(executionRaw.template_ids)) {
      fieldErrors['execution_contract.template_ids'] = 'template_ids must be an array of strings';
    }
  }

  return {
    normalized: normalizeCustomSkillMetadata(input),
    fieldErrors,
  };
}

export function localizeOfficialSkill(
  skill: OfficialSkillDefinition,
  locale: SkillLocale,
): LocalizedOfficialSkill {
  const content = skill.locales[locale];
  return {
    id: skill.id,
    version: skill.version,
    locale,
    category: skill.category,
    priority: skill.priority,
    activation_tags: [...skill.activation_tags],
    execution_contract: cloneExecutionContract(skill.execution_contract),
    name: content.name,
    description: content.description,
    instructions: content.instructions,
    triggers: [...content.triggers],
  };
}

export function listOfficialSkillDefinitions(): OfficialSkillDefinition[] {
  return OFFICIAL_SKILLS.map((skill) => ({
    ...skill,
    activation_tags: [...skill.activation_tags],
    execution_contract: cloneExecutionContract(skill.execution_contract),
    locales: {
      ja: {
        ...skill.locales.ja,
        triggers: [...skill.locales.ja.triggers],
      },
      en: {
        ...skill.locales.en,
        triggers: [...skill.locales.en.triggers],
      },
    },
  }));
}

export function listLocalizedOfficialSkills(locale: SkillLocale): LocalizedOfficialSkill[] {
  return OFFICIAL_SKILLS.map((skill) => localizeOfficialSkill(skill, locale));
}

export function getOfficialSkillById(skillId: string, locale: SkillLocale): LocalizedOfficialSkill | null {
  const skill = OFFICIAL_SKILLS.find((entry) => entry.id === skillId);
  if (!skill) {
    return null;
  }

  return localizeOfficialSkill(skill, locale);
}
