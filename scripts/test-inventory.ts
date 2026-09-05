export type TestManifest = {
  readonly note?: string;
  readonly totals?: { readonly files?: number };
  readonly files: Readonly<Record<string, string>>;
};

export type TestInventory = {
  readonly tracked: readonly string[];
  readonly quarantined: readonly string[];
  readonly online: readonly string[];
};

export type TestInventoryIssue = {
  readonly path: string;
  readonly message: string;
};

type ManifestValidation = {
  readonly manifest: TestManifest | undefined;
  readonly issues: readonly TestInventoryIssue[];
};

export function buildTestInventory(
  tracked: readonly string[],
  quarantine: TestManifest,
  online: TestManifest,
): TestInventory {
  return {
    tracked: [...tracked],
    quarantined: Object.keys(quarantine.files).sort(),
    online: Object.keys(online.files).sort(),
  };
}

export function selectTestFiles(
  inventory: TestInventory,
  mode: "portable" | "online" | "quarantine",
): readonly string[] {
  if (mode === "online") return [...inventory.online];
  if (mode === "quarantine") return [...inventory.quarantined];
  const excluded = new Set([...inventory.quarantined, ...inventory.online]);
  return inventory.tracked.filter((file) => !excluded.has(file));
}

export function canRunTestSelection(
  mode: "portable" | "online" | "quarantine",
  files: readonly string[],
): boolean {
  return mode === "quarantine" || files.length > 0;
}

export function validateTestInventory(
  tracked: readonly string[],
  quarantineValue: unknown,
  onlineValue: unknown,
): {
  readonly inventory: TestInventory;
  readonly issues: readonly TestInventoryIssue[];
} {
  const quarantine = validateManifest(
    "quality/test-quarantine.json",
    quarantineValue,
    tracked,
  );
  const online = validateManifest(
    "quality/test-online.json",
    onlineValue,
    tracked,
  );
  const inventory = buildTestInventory(
    tracked,
    quarantine.manifest ?? { files: {} },
    online.manifest ?? { files: {} },
  );
  const overlap = inventory.quarantined.filter((file) =>
    inventory.online.includes(file),
  );
  const issues = [...quarantine.issues, ...online.issues];
  if (overlap.length > 0) {
    issues.push({
      path: "quality/test-online.json",
      message:
        "Online test files may not also be quarantined: " +
        overlap.join(", "),
    });
  }
  return { inventory, issues };
}

function validateManifest(
  path: string,
  value: unknown,
  tracked: readonly string[],
): ManifestValidation {
  const issues: TestInventoryIssue[] = [];
  if (!isRecord(value)) {
    return {
      manifest: undefined,
      issues: [{ path, message: "Manifest must be a JSON object." }],
    };
  }

  const totals = isRecord(value.totals) ? value.totals : undefined;
  const files = isRecord(value.files) ? value.files : undefined;
  if (
    !totals ||
    typeof totals.files !== "number" ||
    !Number.isInteger(totals.files) ||
    totals.files < 0
  ) {
    issues.push({
      path,
      message: "Manifest totals.files must be a non-negative integer.",
    });
  }
  if (!files) {
    issues.push({ path, message: "Manifest files must be a JSON object." });
  }

  const fileEntries = files ? Object.entries(files) : [];
  if (
    totals &&
    typeof totals.files === "number" &&
    Number.isInteger(totals.files) &&
    totals.files >= 0 &&
    fileEntries.length !== totals.files
  ) {
    issues.push({
      path,
      message:
        `Manifest totals say ${totals.files} file(s) but ` +
        `${fileEntries.length} are listed.`,
    });
  }

  const normalizedFiles: Record<string, string> = {};
  for (const [file, reason] of fileEntries) {
    normalizedFiles[file] = typeof reason === "string" ? reason : "";
    if (typeof reason !== "string" || reason.trim() === "") {
      issues.push({ path, message: `${file} has no reason.` });
      continue;
    }
    if (!tracked.includes(file)) {
      issues.push({
        path,
        message: `${file} is not a tracked test file.`,
      });
    }
  }

  return {
    manifest: {
      note: typeof value.note === "string" ? value.note : undefined,
      totals: {
        files:
          typeof totals?.files === "number" && Number.isInteger(totals.files)
            ? totals.files
            : undefined,
      },
      files: normalizedFiles,
    },
    issues,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
