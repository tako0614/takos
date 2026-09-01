import type { JSX } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { type JsonResponseLike, rpcJson } from "../../lib/rpc.ts";
import { Button, Input, Textarea } from "../../components/ui/index.ts";
import {
  MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
  MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  MAX_CUSTOM_SKILL_LIST_INPUT_CHARACTERS,
  MAX_CUSTOM_SKILL_NAME_CHARACTERS,
  MAX_CUSTOM_SKILL_RESOURCES,
} from "takos-api-contract/shared/types";
import type { SkillResourceTemplate } from "../../types/index.ts";
import { getSkillInstructionByteLength } from "./skill-form-utils.ts";
import { readCustomSkillMutationResponse } from "./skill-response.ts";

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
  name: "",
  description: "",
  instructions: "",
  triggers: "",
  skillLocale: "",
  category: "",
  activationTags: "",
  preferredTools: "",
  durableOutputs: "",
  outputModes: "",
  requiredMcpServers: "",
  templateIds: "",
};

export function splitCsv(value: string): string[] {
  return value
    .split(",")
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

  const hasExecutionContract = Object.values(metadata.execution_contract).some((
    value,
  ) => value.length > 0);
  const hasMetadata = Boolean(
    metadata.locale ||
      metadata.category ||
      metadata.activation_tags.length > 0 ||
      hasExecutionContract,
  );

  if (!hasMetadata) {
    return undefined;
  }

  return {
    ...(metadata.locale ? { locale: metadata.locale } : {}),
    ...(metadata.category ? { category: metadata.category } : {}),
    ...(metadata.activation_tags.length > 0
      ? { activation_tags: metadata.activation_tags }
      : {}),
    ...(hasExecutionContract
      ? { execution_contract: metadata.execution_contract }
      : {}),
  };
}

export class SkillMutationError extends Error {
  constructor(message: string, readonly details?: Record<string, string>) {
    super(message);
    this.name = "SkillMutationError";
  }
}

function isSkillMutationErrorBody(
  data: unknown,
): data is { error?: string; details?: Record<string, string> } {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const hasError = record.error === undefined ||
    typeof record.error === "string";
  const hasDetails = record.details === undefined ||
    (
      typeof record.details === "object" &&
      record.details !== null &&
      Object.values(record.details).every((value) => typeof value === "string")
    );
  return hasError && hasDetails;
}

export async function readSkillMutationResponse(
  response: JsonResponseLike,
  fallbackMessage: string,
  expected: { id?: string; name: string },
) {
  if (response.ok) {
    return readCustomSkillMutationResponse(
      await rpcJson<unknown>(response),
      expected,
    );
  }

  const data = await response.json().catch(() => null);
  const body = isSkillMutationErrorBody(data) ? data : {};
  throw new SkillMutationError(
    body.error || fallbackMessage,
    body.details,
  );
}

const selectStyle: JSX.CSSProperties = {
  "min-height": "2.5rem",
  "border-radius": "var(--radius-md)",
  border: "1px solid var(--color-border-primary)",
  "background-color": "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  padding: "0.5rem 0.75rem",
};

function MetadataInput(props: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
      <label
        for={props.id}
        style={{
          "font-size": "0.875rem",
          "font-weight": 500,
          color: "var(--color-text-secondary)",
        }}
      >
        {props.label}
      </label>
      <Input
        id={props.id}
        name={props.name}
        autocomplete="off"
        maxLength={MAX_CUSTOM_SKILL_LIST_INPUT_CHARACTERS}
        value={props.value}
        onInput={(e) =>
          props.onChange(e.currentTarget.value)}
        placeholder={props.placeholder}
      />
    </div>
  );
}

export function SkillFormView(props: {
  form: SkillFormData;
  setForm: (form: SkillFormData) => void;
  isEditing: boolean;
  saving: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  resourceTemplates: SkillResourceTemplate[];
  onSubmit: (e: Event & { currentTarget: HTMLFormElement }) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const instructionBytes = () =>
    getSkillInstructionByteLength(props.form.instructions);
  const instructionsOverBudget = () =>
    instructionBytes() > MAX_CUSTOM_SKILL_INSTRUCTION_BYTES;
  const selectedResourceIds = () => splitCsv(props.form.templateIds);
  const selectedResourceIdSet = () => new Set(selectedResourceIds());
  const resourceOptions = () => {
    const knownIds = new Set(props.resourceTemplates.map((item) => item.id));
    return [
      ...props.resourceTemplates.map((item) => ({
        ...item,
        unavailable: false,
      })),
      ...selectedResourceIds()
        .filter((id) => !knownIds.has(id))
        .map((id) => ({
          id,
          title: id,
          description: t("skillResourceUnavailable"),
          media_type: "text/markdown" as const,
          unavailable: true,
        })),
    ];
  };

  const updateField = <K extends keyof SkillFormData>(
    key: K,
    value: SkillFormData[K],
  ) => {
    props.setForm({ ...props.form, [key]: value });
  };

  const toggleResource = (resourceId: string, selected: boolean) => {
    const current = selectedResourceIds();
    const next = selected
      ? [...current.filter((id) => id !== resourceId), resourceId]
      : current.filter((id) => id !== resourceId);
    updateField("templateIds", next.join(", "));
  };

  return (
    <form
      autocomplete="off"
      style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}
      onSubmit={props.onSubmit}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.75rem",
          "margin-bottom": "0.5rem",
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onClose}
          disabled={props.saving}
        >
          <Icons.ArrowLeft />
        </Button>
        <h4
          style={{
            "font-size": "1rem",
            "font-weight": 600,
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          {props.isEditing ? t("editSkill") : t("createSkill")}
        </h4>
      </div>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}
      >
        <label
          for="skill-name"
          style={{
            "font-size": "0.875rem",
            "font-weight": 500,
            color: "var(--color-text-secondary)",
          }}
        >
          {t("skillName")}
        </label>
        <Input
          id="skill-name"
          name="name"
          autocomplete="off"
          maxLength={MAX_CUSTOM_SKILL_NAME_CHARACTERS}
          placeholder={t("skillNamePlaceholder")}
          value={props.form.name}
          onInput={(e) => updateField("name", e.currentTarget.value)}
          autofocus
          required
        />
      </div>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}
      >
        <label
          for="skill-description"
          style={{
            "font-size": "0.875rem",
            "font-weight": 500,
            color: "var(--color-text-secondary)",
          }}
        >
          {t("skillDescription")}
        </label>
        <Input
          id="skill-description"
          name="description"
          autocomplete="off"
          maxLength={MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS}
          placeholder={t("skillDescriptionPlaceholder")}
          value={props.form.description}
          onInput={(e) => updateField("description", e.currentTarget.value)}
        />
      </div>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}
      >
        <label
          for="skill-instructions"
          style={{
            "font-size": "0.875rem",
            "font-weight": 500,
            color: "var(--color-text-secondary)",
          }}
        >
          {t("skillInstructions")}
        </label>
        <Textarea
          id="skill-instructions"
          name="instructions"
          autocomplete="off"
          aria-describedby="skill-instructions-budget"
          aria-invalid={instructionsOverBudget()}
          maxLength={MAX_CUSTOM_SKILL_INSTRUCTION_BYTES}
          placeholder={t("skillInstructionsPlaceholder")}
          value={props.form.instructions}
          onInput={(e) => updateField("instructions", e.currentTarget.value)}
          required
          rows={8}
          style={{ "min-height": "200px" }}
        />
        <span
          id="skill-instructions-budget"
          role={instructionsOverBudget() ? "alert" : undefined}
          style={{
            "font-size": "0.75rem",
            color: instructionsOverBudget()
              ? "var(--color-error)"
              : "var(--color-text-tertiary)",
          }}
        >
          {instructionsOverBudget()
            ? t("skillInstructionsTooLarge", {
              count: instructionBytes(),
              limit: MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
            })
            : t("skillInstructionsBytes", {
              count: instructionBytes(),
              limit: MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
            })}
        </span>
      </div>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}
      >
        <label
          for="skill-triggers"
          style={{
            "font-size": "0.875rem",
            "font-weight": 500,
            color: "var(--color-text-secondary)",
          }}
        >
          {t("skillTriggers")}
        </label>
        <Input
          id="skill-triggers"
          name="triggers"
          autocomplete="off"
          maxLength={MAX_CUSTOM_SKILL_LIST_INPUT_CHARACTERS}
          placeholder={t("skillTriggersPlaceholder")}
          value={props.form.triggers}
          onInput={(e) => updateField("triggers", e.currentTarget.value)}
        />
        <span
          style={{
            "font-size": "0.75rem",
            color: "var(--color-text-tertiary)",
          }}
        >
          {t("skillTriggersHint")}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gap: "1rem",
          "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <div
          style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}
        >
          <label
            for="skill-locale"
            style={{
              "font-size": "0.875rem",
              "font-weight": 500,
              color: "var(--color-text-secondary)",
            }}
          >
            {t("skillLocaleLabel")}
          </label>
          <select
            id="skill-locale"
            name="locale"
            autocomplete="off"
            value={props.form.skillLocale}
            onChange={(e) => updateField("skillLocale", e.currentTarget.value)}
            style={selectStyle}
          >
            <option value="">{t("skillLocaleAuto")}</option>
            <option value="ja">{t("skillLocaleJa")}</option>
            <option value="en">{t("skillLocaleEn")}</option>
          </select>
        </div>
        <div
          style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}
        >
          <label
            for="skill-category"
            style={{
              "font-size": "0.875rem",
              "font-weight": 500,
              color: "var(--color-text-secondary)",
            }}
          >
            {t("skillCategoryLabel")}
          </label>
          <select
            id="skill-category"
            name="category"
            autocomplete="off"
            value={props.form.category}
            onChange={(e) => updateField("category", e.currentTarget.value)}
            style={selectStyle}
          >
            <option value="">{t("skillCategoryUnspecified")}</option>
            <option value="research">{t("skillCategoryResearch")}</option>
            <option value="writing">{t("skillCategoryWriting")}</option>
            <option value="planning">{t("skillCategoryPlanning")}</option>
            <option value="slides">{t("skillCategorySlides")}</option>
            <option value="software">{t("skillCategorySoftware")}</option>
          </select>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gap: "1rem",
          "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <MetadataInput
          id="skill-activation-tags"
          name="activation_tags"
          label={t("skillActivationTags")}
          value={props.form.activationTags}
          onChange={(v) => updateField("activationTags", v)}
          placeholder="slides, narrative"
        />
        <MetadataInput
          id="skill-preferred-tools"
          name="preferred_tools"
          label={t("skillPreferredTools")}
          value={props.form.preferredTools}
          onChange={(v) => updateField("preferredTools", v)}
          placeholder="create_artifact, toolbox"
        />
        <MetadataInput
          id="skill-durable-outputs"
          name="durable_output_hints"
          label={t("skillDurableOutputs")}
          value={props.form.durableOutputs}
          onChange={(v) => updateField("durableOutputs", v)}
          placeholder="artifact, workspace_file"
        />
        <MetadataInput
          id="skill-output-modes"
          name="output_modes"
          label={t("skillOutputModes")}
          value={props.form.outputModes}
          onChange={(v) => updateField("outputModes", v)}
          placeholder="chat, artifact"
        />
        <MetadataInput
          id="skill-required-mcp-servers"
          name="required_mcp_servers"
          label={t("skillRequiredMcpServers")}
          value={props.form.requiredMcpServers}
          onChange={(v) => updateField("requiredMcpServers", v)}
          placeholder="figma, notion"
        />
      </div>
      <fieldset
        aria-describedby="skill-resources-hint"
        aria-invalid={Boolean(
          props.fieldErrors["execution_contract.template_ids"],
        )}
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "0.75rem",
          margin: 0,
          padding: "1rem",
          border: "1px solid var(--color-border-primary)",
          "border-radius": "var(--radius-md)",
        }}
      >
        <legend
          style={{
            padding: "0 0.375rem",
            "font-size": "0.875rem",
            "font-weight": 600,
            color: "var(--color-text-primary)",
          }}
        >
          {t("skillResources")}
        </legend>
        <span
          id="skill-resources-hint"
          style={{
            "font-size": "0.75rem",
            color: "var(--color-text-tertiary)",
          }}
        >
          {t("skillResourcesHint", {
            count: selectedResourceIds().length,
            limit: MAX_CUSTOM_SKILL_RESOURCES,
          })}
        </span>
        {resourceOptions().length === 0
          ? (
            <span
              style={{
                "font-size": "0.8rem",
                color: "var(--color-text-secondary)",
              }}
            >
              {t("skillResourcesEmpty")}
            </span>
          )
          : resourceOptions().map((resource) => {
            const selected = () => selectedResourceIdSet().has(resource.id);
            const atLimit = () =>
              selectedResourceIds().length >= MAX_CUSTOM_SKILL_RESOURCES;
            return (
              <label
                style={{
                  display: "grid",
                  "grid-template-columns": "auto minmax(0, 1fr)",
                  gap: "0.625rem",
                  padding: "0.625rem",
                  border: "1px solid var(--color-border-secondary)",
                  "border-radius": "var(--radius-sm)",
                  cursor: resource.unavailable ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name="template_ids"
                  value={resource.id}
                  checked={selected()}
                  disabled={!selected() && (atLimit() || resource.unavailable)}
                  onChange={(event) =>
                    toggleResource(resource.id, event.currentTarget.checked)}
                />
                <span
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "0.2rem",
                  }}
                >
                  <span
                    style={{
                      "font-size": "0.825rem",
                      "font-weight": 600,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {resource.title}
                  </span>
                  <span
                    style={{
                      "font-size": "0.75rem",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {resource.description}
                  </span>
                </span>
              </label>
            );
          })}
        {props.fieldErrors["execution_contract.template_ids"]
          ? (
            <span
              role="alert"
              style={{ color: "var(--color-error)", "font-size": "0.75rem" }}
            >
              {props.fieldErrors["execution_contract.template_ids"]}
            </span>
          )
          : null}
      </fieldset>
      {Object.keys(props.fieldErrors).length > 0
        ? (
          <div
            role="alert"
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "0.25rem",
              "font-size": "0.8rem",
              color: "var(--color-error)",
            }}
          >
            {Object.entries(props.fieldErrors).map(([field, message]) => (
              <span>{field}: {message}</span>
            ))}
          </div>
        )
        : null}
      {props.error && (
        <div
          role="alert"
          style={{ color: "var(--color-error)", "font-size": "0.875rem" }}
        >
          {props.error}
        </div>
      )}
      <div
        style={{
          display: "flex",
          "justify-content": "flex-end",
          gap: "0.75rem",
          "margin-top": "1rem",
        }}
      >
        <Button
          type="button"
          variant="secondary"
          onClick={props.onClose}
          disabled={props.saving}
        >
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={props.saving}
          disabled={!props.form.name.trim() ||
            !props.form.instructions.trim() || instructionsOverBudget()}
        >
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
