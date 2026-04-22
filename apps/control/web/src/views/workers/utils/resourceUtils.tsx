import type { JSX } from "solid-js";

import { Icons } from "../../../lib/Icons.tsx";
import type { TranslationKey } from "../../../store/i18n.ts";
import type { Resource } from "../../../types/index.ts";

export function getResourceTypeIcon(type: Resource["type"]): JSX.Element {
  switch (type) {
    case "d1":
      return <Icons.Database />;
    case "r2":
      return <Icons.Bucket />;
    case "kv":
      return <Icons.Key />;
    case "vectorize":
      return <Icons.Search />;
    case "worker":
      return <Icons.Server />;
    default:
      return <Icons.Database />;
  }
}

export function getResourceTypeName(
  type: Resource["type"],
  t: (key: TranslationKey) => string,
): string {
  switch (type) {
    case "d1":
      return t("d1Database");
    case "r2":
      return t("r2Storage");
    case "kv":
      return t("kvStore");
    case "vectorize":
      return t("vectorizeIndex");
    case "worker":
      return t("workerResource");
    default:
      return type;
  }
}

export function getResourceStatusLabel(
  status: Resource["status"],
  t: (key: TranslationKey) => string,
): string {
  const key = `resourceStatus_${status}` as TranslationKey;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getResourceStatusBgClass(status: Resource["status"]): string {
  switch (status) {
    case "active":
      return "bg-zinc-900";
    case "creating":
      return "bg-zinc-500";
    case "error":
      return "bg-zinc-400";
    default:
      return "bg-zinc-300";
  }
}
