const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".json": "json",
  ".json5": "json",
  ".jsonl": "json",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".xml": "xml",
  ".svg": "xml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".py": "python",
  ".rb": "ruby",
  ".php": "php",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".r": "r",
  ".R": "r",
  ".lua": "lua",
  ".pl": "perl",
  ".dart": "dart",
  ".dockerfile": "dockerfile",
  ".bat": "bat",
  ".cmd": "bat",
  ".ps1": "powershell",
  ".ini": "ini",
  ".toml": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".diff": "diff",
  ".patch": "diff",
  ".vue": "html",
  ".svelte": "html",
};

export function detectLanguage(fileName: string): string {
  const ext = getExtension(fileName);
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) return EXTENSION_LANGUAGE_MAP[ext];
  const baseName = fileName.toLowerCase();
  if (baseName === "dockerfile") return "dockerfile";
  if (baseName === "makefile") return "shell";
  return "plaintext";
}

function getExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) return null;
  return fileName.slice(lastDot).toLowerCase();
}
