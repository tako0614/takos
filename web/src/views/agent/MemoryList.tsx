import { createMemo, createSignal, createUniqueId } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import {
  formatImportanceStars,
  formatLocalizedDate,
} from "../../lib/memory-format.ts";
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
} from "../../components/ui/index.ts";
import type { Memory } from "../../types/index.ts";

export function MemoryList(props: {
  memories: Memory[];
  hasError?: boolean;
  onDelete: (id: string) => void;
  onCreateMemory: (
    data: { content: string; type: Memory["type"]; category?: string },
  ) => Promise<boolean>;
  savingMemory: boolean;
  // Shared classification helpers from useMemoryData — same source as the
  // full-page MemoryList so the two surfaces cannot drift on type icon/label.
  getTypeIcon: (type: Memory["type"]) => string;
  getTypeLabel: (type: Memory["type"]) => string;
}) {
  const i18n = useI18n();
  const t = i18n.t;
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeFilter, setActiveFilter] = createSignal<
    "all" | "episode" | "semantic" | "procedural"
  >("all");
  const [showCreateMemory, setShowCreateMemory] = createSignal(false);

  const [memoryContent, setMemoryContent] = createSignal("");
  const [memoryType, setMemoryType] = createSignal<Memory["type"]>("semantic");
  const [memoryCategory, setMemoryCategory] = createSignal("");
  const fieldPrefix = createUniqueId();
  const contentId = `${fieldPrefix}-content`;
  const typeLabelId = `${fieldPrefix}-type-label`;
  const typeId = `${fieldPrefix}-type`;
  const categoryId = `${fieldPrefix}-category`;

  const filteredMemories = createMemo(() =>
    props.memories.filter((m) => {
      const matchesFilter = activeFilter() === "all" ||
        m.type === activeFilter();
      const matchesSearch = !searchQuery() ||
        m.content.toLowerCase().includes(searchQuery().toLowerCase()) ||
        (m.category &&
          m.category.toLowerCase().includes(searchQuery().toLowerCase()));
      return matchesFilter && matchesSearch;
    })
  );

  const handleCreateMemory = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    if (!memoryContent().trim()) return;
    const created = await props.onCreateMemory({
      content: memoryContent().trim(),
      type: memoryType(),
      category: memoryCategory().trim() || undefined,
    });
    if (!created) return;
    setMemoryContent("");
    setMemoryCategory("");
    setShowCreateMemory(false);
  };

  return (
    <>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}
      >
        <Input
          placeholder={t("memorySearch")}
          aria-label={t("memorySearch")}
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          leftIcon={<Icons.Search style={{ width: "1rem", height: "1rem" }} />}
        />
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "0.5rem" }}>
          {(["all", "episode", "semantic", "procedural"] as const).map(
            (filter) => (
              <Button
                variant={activeFilter() === filter ? "primary" : "secondary"}
                size="sm"
                aria-pressed={activeFilter() === filter}
                onClick={() => setActiveFilter(filter)}
              >
                {filter === "all"
                  ? t("taskFilterAll")
                  : `${props.getTypeIcon(filter)} ${props.getTypeLabel(filter)}`}
              </Button>
            ),
          )}
        </div>
      </div>

      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}
      >
        {filteredMemories().length === 0
          ? !props.hasError && (
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                padding: "3rem 0",
                color: "var(--color-text-tertiary)",
                gap: "0.75rem",
              }}
            >
              <Icons.HardDrive />
              <p>{t("noMemories")}</p>
            </div>
          )
          : (
            filteredMemories().map((memory) => (
              <Card padding="md">
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "0.75rem",
                    "margin-bottom": "0.5rem",
                  }}
                >
                  <Badge variant="default">
                    {props.getTypeIcon(memory.type)}{" "}
                    {props.getTypeLabel(memory.type)}
                  </Badge>
                  {memory.category && (
                    <Badge variant="default">{memory.category}</Badge>
                  )}
                  <span
                    style={{
                      color: "var(--color-text-tertiary)",
                      "font-size": "0.875rem",
                      "margin-left": "auto",
                    }}
                    title={t("memoryImportance")}
                  >
                    {formatImportanceStars(memory.importance)}
                  </span>
                </div>
                <div
                  style={{
                    color: "var(--color-text-primary)",
                    "font-size": "0.875rem",
                    "line-height": "1.6",
                  }}
                >
                  {memory.content}
                </div>
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    "margin-top": "0.75rem",
                    "padding-top": "0.75rem",
                    "border-top": "1px solid var(--color-border-primary)",
                  }}
                >
                  <span
                    style={{
                      "font-size": "0.75rem",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {t("memoryAccessCount")}: {memory.access_count}
                  </span>
                  <span
                    style={{
                      "font-size": "0.75rem",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {formatLocalizedDate(memory.created_at, i18n.lang)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => props.onDelete(memory.id)}
                    title={t("deleteMemory")}
                    aria-label={t("deleteMemory")}
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    <Icons.Trash />
                  </Button>
                </div>
              </Card>
            ))
          )}
      </div>

      <Button
        variant="secondary"
        leftIcon={<Icons.Plus />}
        onClick={() => setShowCreateMemory(true)}
        style={{
          width: "100%",
          "margin-top": "0.5rem",
          border: "2px dashed var(--color-border-primary)",
        }}
      >
        {t("createMemory")}
      </Button>

      <Modal
        isOpen={showCreateMemory()}
        onClose={() => setShowCreateMemory(false)}
        title={t("createMemory")}
      >
        <form onSubmit={handleCreateMemory}>
          <div
            style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}
          >
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                for={contentId}
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("memoryContent")}
              </label>
              <Textarea
                id={contentId}
                placeholder={t("memoryContentPlaceholder")}
                value={memoryContent()}
                onInput={(e) => setMemoryContent(e.currentTarget.value)}
                rows={4}
                required
                autofocus
              />
            </div>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                id={typeLabelId}
                for={typeId}
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("memoryType")}
              </label>
              <Select
                id={typeId}
                aria-labelledby={typeLabelId}
                value={memoryType()}
                onChange={(value) => setMemoryType(value as Memory["type"])}
                options={[
                  {
                    value: "semantic",
                    label: `${props.getTypeIcon("semantic")} ${
                      t("memorySemantic")
                    }`,
                  },
                  {
                    value: "episode",
                    label: `${props.getTypeIcon("episode")} ${
                      t("memoryEpisode")
                    }`,
                  },
                  {
                    value: "procedural",
                    label: `${props.getTypeIcon("procedural")} ${
                      t("memoryProcedural")
                    }`,
                  },
                ]}
              />
            </div>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                for={categoryId}
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("memoryCategory")}
              </label>
              <Input
                id={categoryId}
                placeholder={t("memoryCategoryPlaceholder")}
                value={memoryCategory()}
                onInput={(e) => setMemoryCategory(e.currentTarget.value)}
              />
            </div>
          </div>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateMemory(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={props.savingMemory}
              disabled={!memoryContent().trim()}
            >
              {t("create")}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
