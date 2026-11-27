const MAX_IMPORTANCE_STARS = 5;

export function formatImportanceStars(importance: number): string {
  const normalized = Number.isFinite(importance)
    ? Math.round(importance * MAX_IMPORTANCE_STARS)
    : 0;
  const filled = Math.min(MAX_IMPORTANCE_STARS, Math.max(0, normalized));
  return "\u2605".repeat(filled) +
    "\u2606".repeat(MAX_IMPORTANCE_STARS - filled);
}

export function formatLocalizedDate(isoDate: string, lang: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US");
}
