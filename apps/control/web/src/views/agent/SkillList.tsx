import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Badge, Button, Card } from "../../components/ui/index.ts";
import type { ManagedSkill, Skill } from "../../types/index.ts";

function formatList(values?: string[]) {
  return values && values.length > 0 ? values.join(", ") : "none";
}

function renderTriggers(triggersToRender: string[]) {
  if (triggersToRender.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        gap: "0.5rem",
        "margin-top": "0.75rem",
      }}
    >
      {triggersToRender.map((trigger, _i) => (
        <Badge variant="default">
          {trigger}
        </Badge>
      ))}
    </div>
  );
}

function renderExecutionContract(
  skill: Pick<ManagedSkill, "execution_contract">,
) {
  const contract = skill.execution_contract;
  if (!contract) {
    return null;
  }
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.35rem",
        "margin-top": "0.75rem",
        "font-size": "0.8rem",
        color: "var(--color-text-tertiary)",
      }}
    >
      <span>tools: {formatList(contract.preferred_tools)}</span>
      <span>outputs: {formatList(contract.durable_output_hints)}</span>
      <span>modes: {formatList(contract.output_modes)}</span>
      <span>mcp: {formatList(contract.required_mcp_servers)}</span>
      <span>templates: {formatList(contract.template_ids)}</span>
    </div>
  );
}

function renderAvailability(skill: ManagedSkill) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.35rem",
        "margin-top": "0.75rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap" }}>
        {skill.version
          ? <Badge variant="default">v{skill.version}</Badge>
          : null}
        {skill.availability
          ? <Badge variant="default">{skill.availability}</Badge>
          : null}
      </div>
      {skill.availability_reasons && skill.availability_reasons.length > 0
        ? (
          <div
            style={{
              "font-size": "0.8rem",
              color: "var(--color-text-tertiary)",
            }}
          >
            {skill.availability_reasons.join(" / ")}
          </div>
        )
        : null}
    </div>
  );
}

export function SkillList({
  skills,
  managedSkills,
  onEdit,
  onDelete,
  onToggle,
  onCreateNew,
}: {
  skills: Skill[];
  managedSkills: ManagedSkill[];
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onToggle: (skill: Skill) => void;
  onCreateNew: () => void;
}) {
  const { t, tOr } = useI18n();

  return (
    <>
      <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.75rem",
          }}
        >
          <div>
            <h4
              style={{
                "font-size": "0.95rem",
                "font-weight": 600,
                color: "var(--color-text-primary)",
                margin: 0,
              }}
            >
              {tOr("managedSkills", "Managed Skills")}
            </h4>
            <p
              style={{
                "font-size": "0.875rem",
                color: "var(--color-text-tertiary)",
                "margin-top": "0.25rem",
                "margin-bottom": 0,
              }}
            >
              {tOr(
                "managedSkillsHint",
                "Default-injected managed skills available in this workspace",
              )}
            </p>
          </div>
          {managedSkills.map((skill) => (
            <Card padding="md">
              <div
                style={{
                  display: "flex",
                  "align-items": "flex-start",
                  gap: "0.75rem",
                }}
              >
                <div
                  style={{
                    width: "2.5rem",
                    height: "2.5rem",
                    "border-radius": "var(--radius-md)",
                    "background-color": "var(--color-bg-tertiary)",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    color: "var(--color-text-primary)",
                    "flex-shrink": 0,
                  }}
                >
                  <Icons.Sparkles />
                </div>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "0.5rem",
                      "flex-wrap": "wrap",
                    }}
                  >
                    <h4
                      style={{
                        "font-weight": 500,
                        color: "var(--color-text-primary)",
                        margin: 0,
                      }}
                    >
                      {skill.name}
                    </h4>
                    <Badge variant="default">managed</Badge>
                    <Badge variant="default">{skill.category}</Badge>
                  </div>
                  <p
                    style={{
                      "font-size": "0.875rem",
                      color: "var(--color-text-tertiary)",
                      "margin-top": "0.25rem",
                      "margin-bottom": 0,
                    }}
                  >
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

        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.75rem",
          }}
        >
          <h4
            style={{
              "font-size": "0.95rem",
              "font-weight": 600,
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            {tOr("customSkills", "Custom Skills")}
          </h4>
          {skills.length === 0
            ? (
              <div
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  "justify-content": "center",
                  padding: "3rem 0",
                  color: "var(--color-text-tertiary)",
                  gap: "1rem",
                }}
              >
                <div
                  style={{
                    width: "4rem",
                    height: "4rem",
                    "border-radius": "50%",
                    "background-color": "var(--color-bg-tertiary)",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    color: "var(--color-text-primary)",
                  }}
                >
                  <Icons.Sparkles style={{ width: "2rem", height: "2rem" }} />
                </div>
                <div style={{ "text-align": "center" }}>
                  <p
                    style={{
                      color: "var(--color-text-primary)",
                      "font-weight": 500,
                    }}
                  >
                    {t("noSkills")}
                  </p>
                  <p
                    style={{
                      "font-size": "0.875rem",
                      color: "var(--color-text-tertiary)",
                      "margin-top": "0.25rem",
                    }}
                  >
                    {tOr(
                      "skillsEmptyHint",
                      "Create custom skills to extend your agent's capabilities",
                    )}
                  </p>
                </div>
                <Button
                  variant="primary"
                  leftIcon={
                    <Icons.Plus style={{ width: "1rem", height: "1rem" }} />
                  }
                  onClick={onCreateNew}
                >
                  {t("addSkill")}
                </Button>
              </div>
            )
            : (
              <div
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  gap: "0.75rem",
                }}
              >
                {skills.map((skill) => (
                  <Card
                    padding="md"
                    style={{ opacity: skill.enabled ? 1 : 0.5 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        "align-items": "flex-start",
                        gap: "0.75rem",
                      }}
                    >
                      <div
                        style={{
                          width: "2.5rem",
                          height: "2.5rem",
                          "border-radius": "var(--radius-md)",
                          "background-color": "var(--color-bg-tertiary)",
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "center",
                          color: "var(--color-text-primary)",
                          "flex-shrink": 0,
                        }}
                      >
                        <Icons.Code />
                      </div>
                      <div style={{ flex: 1, "min-width": 0 }}>
                        <h4
                          style={{
                            "font-weight": 500,
                            color: "var(--color-text-primary)",
                            margin: 0,
                          }}
                        >
                          {skill.name}
                        </h4>
                        {skill.description && (
                          <span
                            style={{
                              "font-size": "0.875rem",
                              color: "var(--color-text-tertiary)",
                              display: "-webkit-box",
                              "-webkit-line-clamp": 2,
                              "-webkit-box-orient": "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {skill.description}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "0.25rem",
                          "flex-shrink": 0,
                        }}
                      >
                        <Button
                          variant={skill.enabled ? "primary" : "secondary"}
                          size="sm"
                          onClick={() => onToggle(skill)}
                          title={skill.enabled
                            ? t("skillEnabled")
                            : t("skillDisabled")}
                        >
                          {skill.enabled ? <Icons.Check /> : <Icons.X />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(skill)}
                          title={t("edit")}
                        >
                          <Icons.Edit />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(skill)}
                          title={t("deleteSkill")}
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          <Icons.Trash />
                        </Button>
                      </div>
                    </div>
                    {renderTriggers(skill.triggers)}
                    {skill.metadata
                      ? (
                        <div
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            "flex-wrap": "wrap",
                            "margin-top": "0.75rem",
                          }}
                        >
                          {skill.metadata.locale
                            ? (
                              <Badge variant="default">
                                {skill.metadata.locale}
                              </Badge>
                            )
                            : null}
                          {skill.metadata.category
                            ? (
                              <Badge variant="default">
                                {skill.metadata.category}
                              </Badge>
                            )
                            : null}
                        </div>
                      )
                      : null}
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
        style={{
          width: "100%",
          "margin-top": "1rem",
          border: "2px dashed var(--color-border-primary)",
        }}
      >
        {t("addSkill")}
      </Button>
    </>
  );
}
