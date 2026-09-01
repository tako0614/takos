import { createEffect, createSignal, Show, untrack } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson, rpcPath } from "../../lib/rpc.ts";
import { SkeletonList } from "../../components/Skeleton.tsx";
import { Button } from "../../components/ui/index.ts";
import type {
  ManagedSkill,
  Skill,
  SkillResourceTemplate,
} from "../../types/index.ts";
import { SkillList } from "./SkillList.tsx";
import {
  buildSkillMetadata,
  INITIAL_SKILL_FORM,
  readSkillMutationResponse,
  type SkillFormData,
  SkillFormView,
  SkillMutationError,
  splitCsv,
} from "./SkillForm.tsx";
import {
  getSkillInstructionByteLength,
  validateSkillResourceSelection,
} from "./skill-form-utils.ts";
import {
  MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  MAX_CUSTOM_SKILL_RESOURCES,
} from "takos-api-contract/shared/types";
import {
  readCustomSkillListResponse,
  readManagedSkillCatalogResponse,
  readSkillDeleteResponse,
  readSkillToggleResponse,
} from "./skill-response.ts";

export function SkillsTab(
  props: { spaceId: string; canEdit: boolean; canDelete: boolean },
) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [skills, setSkills] = createSignal<Skill[]>([]);
  const [managedSkills, setManagedSkills] = createSignal<ManagedSkill[]>([]);
  const [resourceTemplates, setResourceTemplates] = createSignal<
    SkillResourceTemplate[]
  >([]);
  const [loading, setLoading] = createSignal(true);
  const [editingSkill, setEditingSkill] = createSignal<Skill | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);

  const [form, setForm] = createSignal<SkillFormData>(INITIAL_SKILL_FORM);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>(
    {},
  );
  const [skillLoadError, setSkillLoadError] = createSignal<string | null>(null);
  const [mutatingSkillId, setMutatingSkillId] = createSignal<string | null>(
    null,
  );
  const [mutationKind, setMutationKind] = createSignal<
    "toggle" | "delete" | null
  >(null);
  let skillsSeq = 0;
  let skillsSpaceId: string | null = null;

  createEffect(() => {
    const spaceId = props.spaceId;
    if (skillsSpaceId !== spaceId) {
      skillsSpaceId = spaceId;
      setSkills([]);
      setManagedSkills([]);
      setResourceTemplates([]);
      setSkillLoadError(null);
      setIsCreating(false);
      setEditingSkill(null);
      setForm(INITIAL_SKILL_FORM);
      setError(null);
      setFieldErrors({});
    }
    void fetchSkills(spaceId);
  });

  const fetchSkills = async (spaceId = props.spaceId) => {
    const seq = ++skillsSeq;
    setLoading(
      untrack(skills).length === 0 && untrack(managedSkills).length === 0,
    );
    try {
      const [customRes, managedRes] = await Promise.all([
        rpcPath(rpc, "spaces", ":spaceId", "skills").$get({
          param: { spaceId },
        }),
        rpcPath(rpc, "spaces", ":spaceId", "managed-skills").$get({
          param: { spaceId },
        }),
      ]);
      const customData = readCustomSkillListResponse(
        await rpcJson<unknown>(customRes),
      );
      const managedCatalog = readManagedSkillCatalogResponse(
        await rpcJson<unknown>(managedRes),
      );
      if (seq !== skillsSeq || spaceId !== props.spaceId) return;
      setSkills(customData);
      setManagedSkills(managedCatalog.skills);
      setResourceTemplates(managedCatalog.resourceTemplates);
      setSkillLoadError(null);
    } catch {
      if (seq !== skillsSeq || spaceId !== props.spaceId) return;
      setSkillLoadError(t("failedToLoadSkills"));
    } finally {
      if (seq === skillsSeq && spaceId === props.spaceId) {
        setLoading(false);
      }
    }
  };

  const resetForm = () => {
    setForm(INITIAL_SKILL_FORM);
    setError(null);
    setFieldErrors({});
  };

  const openCreateForm = () => {
    if (!props.canEdit || saving() || mutatingSkillId()) return;
    resetForm();
    setEditingSkill(null);
    setIsCreating(true);
  };

  const openEditForm = (skill: Skill) => {
    if (!props.canEdit || mutatingSkillId()) return;
    setForm({
      name: skill.name,
      description: skill.description || "",
      instructions: skill.instructions,
      triggers: skill.triggers.join(", "),
      skillLocale: skill.metadata?.locale || "",
      category: skill.metadata?.category || "",
      activationTags: (skill.metadata?.activation_tags || []).join(", "),
      preferredTools:
        (skill.metadata?.execution_contract?.preferred_tools || []).join(", "),
      durableOutputs:
        (skill.metadata?.execution_contract?.durable_output_hints || []).join(
          ", ",
        ),
      outputModes: (skill.metadata?.execution_contract?.output_modes || [])
        .join(", "),
      requiredMcpServers:
        (skill.metadata?.execution_contract?.required_mcp_servers || []).join(
          ", ",
        ),
      templateIds: (skill.metadata?.execution_contract?.template_ids || [])
        .join(", "),
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

  const handleSubmit = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    if (!props.canEdit || saving()) return;
    const f = form();
    if (!f.name.trim() || !f.instructions.trim()) return;
    if (
      getSkillInstructionByteLength(f.instructions) >
        MAX_CUSTOM_SKILL_INSTRUCTION_BYTES
    ) {
      setFieldErrors({
        instructions: t("skillInstructionsTooLarge", {
          count: getSkillInstructionByteLength(f.instructions),
          limit: MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
        }),
      });
      return;
    }
    const resourceIds = splitCsv(f.templateIds);
    const resourceSelectionError = validateSkillResourceSelection(
      resourceIds,
      MAX_CUSTOM_SKILL_RESOURCES,
    );
    if (resourceSelectionError) {
      setFieldErrors({
        "execution_contract.template_ids": resourceSelectionError === "too_many"
          ? t("skillResourcesTooMany", { limit: MAX_CUSTOM_SKILL_RESOURCES })
          : t("skillResourcesDuplicate"),
      });
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const triggersArray = splitCsv(f.triggers);
    const metadata = buildSkillMetadata(f);

    try {
      const skill = editingSkill();
      if (skill) {
        const res = await rpcPath(
          rpc,
          "spaces",
          ":spaceId",
          "skills",
          "id",
          ":skillId",
        ).$put({
          param: { spaceId: props.spaceId, skillId: skill.id },
          json: {
            name: f.name.trim(),
            description: f.description.trim() || null,
            instructions: f.instructions.trim(),
            triggers: triggersArray,
            metadata: metadata ?? null,
          },
        });
        await readSkillMutationResponse(res, t("failedToSaveSkill"), {
          id: skill.id,
          name: f.name.trim(),
        });
      } else {
        const res = await rpcPath(rpc, "spaces", ":spaceId", "skills").$post({
          param: { spaceId: props.spaceId },
          json: {
            name: f.name.trim(),
            description: f.description.trim() || null,
            instructions: f.instructions.trim(),
            triggers: triggersArray,
            metadata: metadata ?? null,
          },
        });
        await readSkillMutationResponse(res, t("failedToSaveSkill"), {
          name: f.name.trim(),
        });
      }
      closeForm();
      await fetchSkills();
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "details" in err) {
        const details = (err as { details?: Record<string, string> }).details;
        if (details && typeof details === "object") {
          setFieldErrors(details);
        }
      }
      setError(
        err instanceof SkillMutationError
          ? err.message
          : t("failedToSaveSkill"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skill: Skill) => {
    if (!props.canDelete || mutatingSkillId()) return;
    setMutatingSkillId(skill.id);
    setMutationKind("delete");

    try {
      const confirmed = await confirm({
        title: t("confirmDelete"),
        message: t("confirmDeleteSkill"),
        confirmText: t("delete"),
        danger: true,
      });
      if (!confirmed) return;
      const res = await rpcPath(
        rpc,
        "spaces",
        ":spaceId",
        "skills",
        "id",
        ":skillId",
      ).$delete({
        param: { spaceId: props.spaceId, skillId: skill.id },
      });
      readSkillDeleteResponse(await rpcJson<unknown>(res));
      await fetchSkills();
    } catch {
      showToast("error", t("deleteSkillFailed"));
    } finally {
      setMutatingSkillId(null);
      setMutationKind(null);
    }
  };

  const handleToggle = async (skill: Skill) => {
    if (!props.canEdit || mutatingSkillId()) return;
    const expectedEnabled = !skill.enabled;
    setMutatingSkillId(skill.id);
    setMutationKind("toggle");
    try {
      const res = await rpcPath(
        rpc,
        "spaces",
        ":spaceId",
        "skills",
        "id",
        ":skillId",
      ).$patch({
        param: { spaceId: props.spaceId, skillId: skill.id },
        json: { enabled: expectedEnabled },
      });
      readSkillToggleResponse(
        await rpcJson<unknown>(res),
        expectedEnabled,
      );
      await fetchSkills();
    } catch {
      showToast("error", t("skillToggleFailed"));
    } finally {
      setMutatingSkillId(null);
      setMutationKind(null);
    }
  };

  return (
    <Show when={!loading()} fallback={<SkeletonList count={3} />}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
        <Show when={skillLoadError()}>
          {(message) => (
            <div
              role="alert"
              aria-live="assertive"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
            >
              <span>{message()}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchSkills()}
                disabled={loading()}
              >
                {t("retry")}
              </Button>
            </div>
          )}
        </Show>
        {isCreating()
          ? (
            <SkillFormView
              form={form()}
              setForm={setForm}
              isEditing={!!editingSkill()}
              saving={saving()}
              error={error()}
              fieldErrors={fieldErrors()}
              resourceTemplates={resourceTemplates()}
              onSubmit={handleSubmit}
              onClose={closeForm}
            />
          )
          : (
            <Show
              when={skills().length > 0 || managedSkills().length > 0 ||
                !skillLoadError()}
            >
              <SkillList
                skills={skills()}
                managedSkills={managedSkills()}
                onEdit={openEditForm}
                onDelete={handleDelete}
                onToggle={handleToggle}
                onCreateNew={openCreateForm}
                canEdit={props.canEdit}
                canDelete={props.canDelete}
                mutatingSkillId={mutatingSkillId()}
                mutationKind={mutationKind()}
              />
            </Show>
          )}
      </div>
    </Show>
  );
}
