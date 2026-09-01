export interface SkillTemplateDefinition {
  id: string;
  title: string;
  description: string;
}

export interface SkillTemplateResource {
  id: string;
  title: string;
  description: string;
  mediaType: "text/markdown";
  content: string;
}

export type SkillTemplateDescriptor = Omit<SkillTemplateResource, "content">;

const MANAGED_SKILL_TEMPLATES: SkillTemplateDefinition[] = [
  {
    id: "research-brief",
    title: "Research Brief",
    description: "Short evidence-backed research brief structure.",
  },
  {
    id: "writing-draft",
    title: "Writing Draft",
    description:
      "Reusable draft structure for messages, reports, and documents.",
  },
  {
    id: "planning-structurer",
    title: "Planning Structurer",
    description: "Goal, constraints, phases, and next-step planning scaffold.",
  },
  {
    id: "slides-outline",
    title: "Slides Outline",
    description: "Slide-by-slide narrative outline scaffold.",
  },
  {
    id: "speaker-notes",
    title: "Speaker Notes",
    description: "Per-slide speaker note scaffold.",
  },
  {
    id: "repo-app-bootstrap",
    title: "Repo App Bootstrap",
    description: "Repo-local app bootstrap scaffold.",
  },
  {
    id: "api-worker",
    title: "API Service",
    description: "Minimal API worker scaffold.",
  },
];

const TEMPLATE_RESOURCE_CONTENTS: Record<
  string,
  Record<"ja" | "en", { title: string; description: string; content: string }>
> = {
  "research-brief": {
    ja: {
      title: "調査ブリーフ雛形",
      description: "主張、根拠、不確実性を分離する短い調査ブリーフ。",
      content: `# 調査ブリーフ

## 調査課題

## 結論

## 根拠

| 主張 | 根拠 | 出典 | 確度 |
| --- | --- | --- | --- |

## 反証・不確実性

## 次に確認すること`,
    },
    en: {
      title: "Research brief template",
      description:
        "A short brief that separates claims, evidence, and uncertainty.",
      content: `# Research brief

## Question

## Conclusion

## Evidence

| Claim | Evidence | Source | Confidence |
| --- | --- | --- | --- |

## Counterevidence and uncertainty

## Next verification`,
    },
  },
  "writing-draft": {
    ja: {
      title: "文章ドラフト雛形",
      description: "読者、目的、構成を先に固定する文章作成用の骨組み。",
      content: `# 文章ドラフト

## 読者と目的

- 読者:
- 読後に理解・実行してほしいこと:

## 要点

## 本文

## 削れる内容・未確認事項`,
    },
    en: {
      title: "Writing draft template",
      description:
        "A writing scaffold that fixes audience, purpose, and structure first.",
      content: `# Writing draft

## Audience and purpose

- Audience:
- What the reader should understand or do:

## Key points

## Draft

## Material to cut or verify`,
    },
  },
  "planning-structurer": {
    ja: {
      title: "実行計画雛形",
      description: "目標、制約、依存関係、検証を一つにまとめる計画書。",
      content: `# 実行計画

## 目標と完了条件

## 制約・対象外

## 現在の証拠

## 手順と依存関係

| 手順 | 依存 | 完了を示す証拠 |
| --- | --- | --- |

## リスクと戻し方

## 次の一手`,
    },
    en: {
      title: "Execution plan template",
      description:
        "A plan that keeps goals, constraints, dependencies, and evidence together.",
      content: `# Execution plan

## Goal and completion criteria

## Constraints and non-goals

## Current evidence

## Steps and dependencies

| Step | Depends on | Completion evidence |
| --- | --- | --- |

## Risks and reversal

## Next action`,
    },
  },
  "slides-outline": {
    ja: {
      title: "スライド構成雛形",
      description: "一枚一メッセージで物語を組み立てるスライド構成。",
      content: `# スライド構成

| # | この一枚で伝えること | 必要な証拠・図 | 次への接続 |
| --- | --- | --- | --- |
| 1 | | | |

## 冒頭で示す問い

## 最後に残す判断・行動`,
    },
    en: {
      title: "Slide outline template",
      description: "A one-message-per-slide narrative outline.",
      content: `# Slide outline

| # | Single message | Evidence or visual | Transition |
| --- | --- | --- | --- |
| 1 | | | |

## Opening question

## Final decision or action`,
    },
  },
  "speaker-notes": {
    ja: {
      title: "スピーカーノート雛形",
      description: "読み上げ原稿ではなく、意図と補足を残すノート。",
      content: `# スピーカーノート

## スライド番号・目的

## 口頭で補う要点

## 強調する数字・出典

## 想定質問

## 次のスライドへの一文`,
    },
    en: {
      title: "Speaker notes template",
      description:
        "Notes for intent and supporting detail rather than a read-aloud script.",
      content: `# Speaker notes

## Slide number and purpose

## Points to explain aloud

## Numbers and sources to emphasize

## Likely questions

## Transition sentence`,
    },
  },
  "repo-app-bootstrap": {
    ja: {
      title: "リポジトリアプリ開始チェックリスト",
      description: "所有境界と検証経路を先に決めるアプリ開始用チェックリスト。",
      content: `# リポジトリアプリ開始チェックリスト

- [ ] product ownerと正本を特定した
- [ ] nearest AGENTS.mdを読んだ
- [ ] public contractとsecret境界を決めた
- [ ] local実行とportable checkを用意した
- [ ] production mutationを通常checkから分離した
- [ ] rollbackまたはforward repairを記録した`,
    },
    en: {
      title: "Repository app bootstrap checklist",
      description:
        "A bootstrap checklist that fixes ownership and verification paths first.",
      content: `# Repository app bootstrap checklist

- [ ] Identify the product owner and canonical source
- [ ] Read the nearest AGENTS.md
- [ ] Define the public contract and secret boundary
- [ ] Provide local execution and a portable check
- [ ] Keep production mutation outside the normal check
- [ ] Record reversal or forward repair`,
    },
  },
  "api-worker": {
    ja: {
      title: "API Worker契約雛形",
      description: "認証、入力、失敗、観測可能性を含む小さなAPI契約。",
      content: `# API Worker契約

## Endpointと所有者

## 認証・認可

## 入力schemaと上限

## 成功response

## 失敗分類とretry可否

## Idempotency

## Observability

## Portable test`,
    },
    en: {
      title: "API Worker contract template",
      description:
        "A compact API contract covering authority, bounds, failure, and evidence.",
      content: `# API Worker contract

## Endpoint and owner

## Authentication and authorization

## Input schema and bounds

## Success response

## Failure classes and retryability

## Idempotency

## Observability

## Portable test`,
    },
  },
};

export function listSkillTemplates(): SkillTemplateDefinition[] {
  return MANAGED_SKILL_TEMPLATES.map((template) => ({ ...template }));
}

export function hasSkillTemplate(templateId: string): boolean {
  return MANAGED_SKILL_TEMPLATES.some((template) => template.id === templateId);
}

export function getSkillTemplateResource(
  templateId: string,
  locale: "ja" | "en",
): SkillTemplateResource | null {
  const resource = TEMPLATE_RESOURCE_CONTENTS[templateId]?.[locale];
  if (!resource || !hasSkillTemplate(templateId)) return null;
  return {
    id: templateId,
    title: resource.title,
    description: resource.description,
    mediaType: "text/markdown",
    content: resource.content,
  };
}

export function listSkillTemplateDescriptors(
  locale: "ja" | "en",
): SkillTemplateDescriptor[] {
  return MANAGED_SKILL_TEMPLATES.map((template) => {
    const resource = getSkillTemplateResource(template.id, locale);
    if (!resource) {
      throw new Error(
        `Skill template resource is missing: ${template.id}/${locale}`,
      );
    }
    const { content: _content, ...descriptor } = resource;
    return descriptor;
  });
}
