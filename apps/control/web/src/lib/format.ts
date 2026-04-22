function diffInDays(dateString: string): number {
  const diffMs = Date.now() - new Date(dateString).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function currentLocale(): string {
  try {
    const stored = globalThis.localStorage?.getItem("takos-lang");
    if (stored === "ja") return "ja-JP";
    if (stored === "en") return "en-US";
  } catch {
    // localStorage may be unavailable in tests or privacy-restricted contexts.
  }
  const browserLang = globalThis.navigator?.language?.toLowerCase();
  return browserLang?.startsWith("ja") ? "ja-JP" : "en-US";
}

function relativeFormatter(): Intl.RelativeTimeFormat {
  return new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
}

function formatDaysAgo(diffDays: number, date: Date): string {
  const formatter = relativeFormatter();
  if (diffDays < 7) return formatter.format(-diffDays, "day");
  if (diffDays < 30) {
    return formatter.format(-Math.floor(diffDays / 7), "week");
  }
  if (diffDays < 365) {
    return formatter.format(-Math.floor(diffDays / 30), "month");
  }
  return date.toLocaleDateString(currentLocale());
}

export function formatRelativeDate(dateString: string): string {
  const days = diffInDays(dateString);
  if (days === 0) return relativeFormatter().format(0, "day");
  return formatDaysAgo(days, new Date(dateString));
}

export function formatDetailedRelativeDate(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return currentLocale().startsWith("ja") ? "たった今" : "Just now";
  }
  const formatter = relativeFormatter();
  if (diffMins < 60) return formatter.format(-diffMins, "minute");
  if (diffHours < 24) return formatter.format(-diffHours, "hour");
  return formatDaysAgo(days, new Date(dateString));
}

export function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(currentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const formatDate = formatShortDate;

export function formatDateTime(dateString: string | undefined): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString(currentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(num);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
