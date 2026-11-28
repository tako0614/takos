import { createEffect, createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson, rpcPath } from "../../lib/rpc.ts";
import { getErrorMessage } from "../../lib/errors.ts";
import { SkeletonList } from "../../components/Skeleton.tsx";
import type { ManagedSkill, Skill } from "../../types/index.ts";
import { SkillList } from "./SkillList.tsx";
import {
  buildSkillMetadata,
  INITIAL_SKILL_FORM,
  readSkillMutationResponse,
  type SkillFormData,
  SkillFormView,
  splitCsv,
} from "./SkillForm.tsx";

export function SkillsTab(props: { spaceId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [skills, setSkills] = createSignal<Skill[]>([]);
  const [managedSkills, setManagedSkills] = createSignal<ManagedSkill[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [editingSkill, setEditingSkill] = createSignal<Skill | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);

  const [form, setForm] = createSignal<SkillFormData>(INITIAL_SKILL_FORM);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>(
    {},
  );
  let skillsSeq = 0;

  createEffect(() => {
    void fetchSkills(props.spaceId);
  });

  const fetchSkills = async (spaceId = props.spaceId) => {
    const seq = ++skillsSeq;
    setLoading(true);
    setLoadError(null);
    try {
      const [customRes, managedRes] = await Promise.all([
        rpcPath(rpc, "spaces", ":spaceId", "skills").$get({
          param: { spaceId },
        }),
        rpcPath(rpc, "spaces", ":spaceId", "managed-skills").$get({
          param: { spaceId },
        }),
      ]);
      const customData = await rpcJson<{ skills: Skill[] }>(customRes);
      const managedData = await rpcJson<{ skills: ManagedSkill[] }>(
        managedRes,
      );
      if (seq !== skillsSeq || spaceId !== props.spaceId) return;
      setSkills(customData.skills || []);
      setManagedSkills(managedData.skills || []);
    } catch (err) {
      if (seq !== skillsSeq || spaceId !== props.spaceId) return;
      setSkills([]);
      setManagedSkills([]);
      setLoadError(getErrorMessage(err, t("failedToLoadSkills")));
      showToast("error", t("failedToLoadSkills"));
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
    resetForm();
    setEditingSkill(null);
    setIsCreating(true);
  };

  const openEditForm = (skill: Skill) => {
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
    const f = form();
    if (!f.name.trim() || !f.instructions.trim()) return;

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
            description: f.description.trim() || undefined,
            instructions: f.instructions.trim(),
            triggers: triggersArray,
            metadata,
          },
        });
        await readSkillMutationResponse(res, t("failedToSaveSkill"));
      } else {
        const res = await rpcPath(rpc, "spaces", ":spaceId", "skills").$post({
          param: { spaceId: props.spaceId },
          json: {
            name: f.name.trim(),
            description: f.description.trim() || undefined,
            instructions: f.instructions.trim(),
            triggers: triggersArray,
            metadata,
          },
        });
        await readSkillMutationResponse(res, t("failedToSaveSkill"));
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
      setError(getErrorMessage(err, t("failedToSaveSkill")));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skill: Skill) => {
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("confirmDeleteSkill"),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;

    try {
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
      await rpcJson(res);
      await fetchSkills();
    } catch {
      showToast("error", t("deleteSkillFailed"));
    }
  };

  const handleToggle = async (skill: Skill) => {
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
        json: { enabled: !skill.enabled },
      });
      await rpcJson(res);
      await fetchSkills();
    } catch {
      showToast("error", t("skillToggleFailed"));
    }
  };

  return (
    <Show
      when={!loading()}
      fallback={
        <div role="status" aria-live="polite">
          <span class="sr-only">{t("loading")}</span>
          <SkeletonList count={3} />
        </div>
      }
    >
      <Show when={loadError() && !isCreating()}>
        <div
          role="alert"
          class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
        >
          <span class="min-w-0 flex-1">{loadError()}</span>
          <button
            type="button"
            class="min-h-[44px] sm:min-h-0 rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            onClick={() => void fetchSkills()}
          >
            {t("retry")}
          </button>
        </div>
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
            onSubmit={handleSubmit}
            onClose={closeForm}
          />
        )
        : (
          <SkillList
            skills={skills()}
            managedSkills={managedSkills()}
            onEdit={openEditForm}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onCreateNew={openCreateForm}
          />
        )}
    </Show>
  );
}
