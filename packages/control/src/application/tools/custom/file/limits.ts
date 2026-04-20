export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".node",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".avi",
  ".mov",
  ".sqlite",
  ".db",
]);

export function isBinaryFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return BINARY_EXTENSIONS.has(ext);
}

export type FileCategory = "source" | "config" | "asset" | "binary" | "large";

interface FileLimits {
  maxSize: number;
  description: string;
}

// Limits sized for the Workers 128MB heap. Tool output is separately capped at
// 10MB (see executor.ts), but we must prevent OOM during TextEncoder.encode().
const FILE_LIMITS: Record<FileCategory, FileLimits> = {
  source: {
    maxSize: 10 * 1024 * 1024,
    description: "Source code files (10MB)",
  },
  config: {
    maxSize: 5 * 1024 * 1024,
    description: "Configuration files (5MB)",
  },
  asset: {
    maxSize: 25 * 1024 * 1024,
    description: "Image and font assets (25MB)",
  },
  binary: { maxSize: 25 * 1024 * 1024, description: "Binary files (25MB)" },
  large: { maxSize: 50 * 1024 * 1024, description: "Large assets (50MB)" },
};

function getFileCategory(path: string): FileCategory {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  const filename = path.split("/").pop()?.toLowerCase() || "";

  const sourceExtensions = new Set([
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".swift",
    ".kt",
    ".scala",
    ".vue",
    ".svelte",
    ".astro",
    ".php",
    ".lua",
    ".sh",
    ".bash",
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".md",
    ".mdx",
  ]);
  if (sourceExtensions.has(ext)) return "source";

  const configExtensions = new Set([
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".xml",
    ".conf",
    ".env.example",
    ".editorconfig",
    ".prettierrc",
    ".eslintrc",
  ]);
  const configFilenames = new Set([
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "webpack.config.js",
    "dockerfile",
    "docker-compose.yml",
    "makefile",
    "cmakelists.txt",
  ]);
  if (configExtensions.has(ext) || configFilenames.has(filename)) {
    return "config";
  }

  const assetExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".bmp",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".eot",
  ]);
  if (assetExtensions.has(ext)) return "asset";

  const largeExtensions = new Set([
    ".mp4",
    ".mov",
    ".avi",
    ".webm",
    ".mkv",
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
    ".sqlite",
    ".db",
  ]);
  if (largeExtensions.has(ext)) return "large";

  if (BINARY_EXTENSIONS.has(ext)) return "binary";

  return "source";
}

export function validateContent(content: string, path: string): void {
  const category = getFileCategory(path);
  const limit = FILE_LIMITS[category];

  // Fast pre-check: string length is always <= byte length for UTF-8,
  // so if the string itself exceeds the limit, skip the expensive encode.
  if (content.length > limit.maxSize) {
    const sizeMB = (content.length / 1024 / 1024).toFixed(2);
    const limitMB = (limit.maxSize / 1024 / 1024).toFixed(2);
    throw new Error(
      `Content too large: ~${sizeMB}MB exceeds ${limitMB}MB limit for ${limit.description}. ` +
        `File category: ${category}`,
    );
  }

  const size = new TextEncoder().encode(content).length;

  if (size > limit.maxSize) {
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    const limitMB = (limit.maxSize / 1024 / 1024).toFixed(2);
    throw new Error(
      `Content too large: ${sizeMB}MB exceeds ${limitMB}MB limit for ${limit.description}. ` +
        `File category: ${category}`,
    );
  }
}

export function validateBinaryContent(
  base64Content: string,
  path: string,
): void {
  const estimatedBinarySize = Math.ceil(base64Content.length * 0.75);
  const category = getFileCategory(path);
  const limit = FILE_LIMITS[category];

  if (estimatedBinarySize > limit.maxSize) {
    const sizeMB = (estimatedBinarySize / 1024 / 1024).toFixed(2);
    const limitMB = (limit.maxSize / 1024 / 1024).toFixed(2);
    throw new Error(
      `Binary content too large: ${sizeMB}MB exceeds ${limitMB}MB limit for ${limit.description}. ` +
        `File category: ${category}`,
    );
  }
}
