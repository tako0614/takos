import { createMemo, createSignal } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
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
import { getMemoryImportanceStars } from "../memory/memory-importance.ts";
import {
  MAX_MEMORY_CATEGORY_CHARACTERS,
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_MEMORY_SEARCH_QUERY_CHARACTERS,
} from "takos-api-contract/shared/types";

export function MemoryList(props: {
  memories: Memory[];
  onDelete: (id: string) => void;
  onCreateMemory: (
    data: { content: string; type: Memory["type"]; category?: string },
  ) => Promise<boolean>;
  onUpdateMemory: (
    id: string,
    data: { content: string; category?: string },
  ) => Promise<boolean>;
  savingMemory: boolean;
  canEdit: boolean;
  // Shared classification helpers from useMemoryData — same source as the
  // full-page MemoryList so the two surfaces cannot drift on type icon/label.
  getTypeIcon: (type: Memory["type"]) => string;
  getTypeLabel: (type: Memory["type"]) => string;
}) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeFilter, setActiveFilter] = createSignal<
    "all" | "episode" | "semantic" | "procedural"
  >("all");
  const [showCreateMemory, setShowCreateMemory] = createSignal(false);
  const [editingMemoryId, setEditingMemoryId] = createSignal<string | null>(
    null,
  );

  const [memoryContent, setMemoryContent] = createSignal("");
  const [memoryType, setMemoryType] = createSignal<Memory["type"]>("semantic");
  const [memoryCategory, setMemoryCategory] = createSignal("");

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
    if (!props.canEdit || !memoryContent().trim()) return;
    const currentId = editingMemoryId();
    const saved = currentId
      ? await props.onUpdateMemory(currentId, {
        content: memoryContent().trim(),
        category: memoryCategory().trim(),
      })
      : await props.onCreateMemory({
        content: memoryContent().trim(),
        type: memoryType(),
        category: memoryCategory().trim() || undefined,
      });
    if (!saved) return;
    setMemoryContent("");
    setMemoryCategory("");
    setEditingMemoryId(null);
    setShowCreateMemory(false);
  };

  const openCreateMemory = () => {
    if (!props.canEdit) return;
    setEditingMemoryId(null);
    setMemoryContent("");
    setMemoryType("semantic");
    setMemoryCategory("");
    setShowCreateMemory(true);
  };

  const openEditMemory = (memory: Memory) => {
    if (!props.canEdit) return;
    setEditingMemoryId(memory.id);
    setMemoryContent(memory.content);
    setMemoryType(memory.type);
    setMemoryCategory(memory.category ?? "");
    setShowCreateMemory(true);
  };

  return (
    <>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}
      >
        <Input
          name="agent-memory-search"
          aria-label={t("memorySearch")}
          placeholder={t("memorySearch")}
          maxLength={MAX_MEMORY_SEARCH_QUERY_CHARACTERS}
          autocomplete="off"
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
          ? (
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
            filteredMemories().map((memory) => {
              const stars = getMemoryImportanceStars(memory.importance);
              return (
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
                    {"★".repeat(stars.filled)}
                    {"☆".repeat(stars.empty)}
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
                    {new Date(memory.created_at).toLocaleDateString()}
                  </span>
                  {props.canEdit && (
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditMemory(memory)}
                      title={t("editMemory")}
                      aria-label={t("editMemory")}
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      <Icons.Edit />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onDelete(memory.id)}
                      title={t("deleteMemory")}
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      <Icons.Trash />
                    </Button>
                  </div>
                  )}
                </div>
                </Card>
              );
            })
          )}
      </div>

      {props.canEdit && (
        <Button
          variant="secondary"
          leftIcon={<Icons.Plus />}
          onClick={openCreateMemory}
          style={{
            width: "100%",
            "margin-top": "0.5rem",
            border: "2px dashed var(--color-border-primary)",
          }}
        >
          {t("createMemory")}
        </Button>
      )}

      <Modal
        isOpen={props.canEdit && showCreateMemory()}
        onClose={() => {
          if (!props.savingMemory) setShowCreateMemory(false);
        }}
        title={editingMemoryId() ? t("editMemory") : t("createMemory")}
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
                for="agent-memory-content"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("memoryContent")}
              </label>
              <Textarea
                id="agent-memory-content"
                name="agent-memory-content"
                placeholder={t("memoryContentPlaceholder")}
                value={memoryContent()}
                onInput={(e) => setMemoryContent(e.currentTarget.value)}
                rows={4}
                maxLength={MAX_MEMORY_CONTENT_CHARACTERS}
                autocomplete="off"
                disabled={props.savingMemory}
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
                for="agent-memory-type"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("memoryType")}
              </label>
              <Select
                id="agent-memory-type"
                name="agent-memory-type"
                aria-label={t("memoryType")}
                disabled={editingMemoryId() !== null || props.savingMemory}
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
                for="agent-memory-category"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("memoryCategory")}
              </label>
              <Input
                id="agent-memory-category"
                name="agent-memory-category"
                placeholder={t("memoryCategoryPlaceholder")}
                value={memoryCategory()}
                maxLength={MAX_MEMORY_CATEGORY_CHARACTERS}
                autocomplete="off"
                disabled={props.savingMemory}
                onInput={(e) => setMemoryCategory(e.currentTarget.value)}
              />
            </div>
          </div>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={props.savingMemory}
              onClick={() => {
                if (!props.savingMemory) setShowCreateMemory(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={props.savingMemory}
              disabled={!memoryContent().trim()}
            >
              {editingMemoryId() ? t("save") : t("create")}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
