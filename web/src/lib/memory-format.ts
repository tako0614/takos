const MAX_IMPORTANCE_STARS = 5;

export function formatImportanceRating(importance: number): number {
  const normalized = Number.isFinite(importance)
    ? Math.round(importance * MAX_IMPORTANCE_STARS)
    : 0;
  return Math.min(MAX_IMPORTANCE_STARS, Math.max(0, normalized));
}

export function formatImportanceStars(importance: number): string {
  const filled = formatImportanceRating(importance);
  return "\u2605".repeat(filled) +
    "\u2606".repeat(MAX_IMPORTANCE_STARS - filled);
}

export function formatLocalizedDate(isoDate: string, lang: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US");
}

export function formatLocalizedDateTime(isoDate: string, lang: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
