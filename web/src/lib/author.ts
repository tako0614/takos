import type { TranslationKey } from "../store/i18n.ts";

interface AuthorLike {
  id: string;
  name: string | null;
}

/**
 * Produces a display string for a PR/comment/review author.
 *
 * The git service only carries the opaque account id; there is no display-name
 * resolution in the web RPC layer yet, so `name` is typically `null`. We render
 * the real account id as a fallback handle (honest: it is real data, just not
 * human-friendly) and only fall back to a localized "Unknown" placeholder when
 * even the id is missing. This avoids stuffing the raw id into the name slot
 * while never fabricating a name.
 */
export function displayAuthorName(
  author: AuthorLike,
  t: (key: TranslationKey) => string,
): string {
  if (author.name && author.name.trim().length > 0) return author.name;
  if (author.id && author.id.trim().length > 0) return author.id;
  return t("unknownAuthor");
}

/** First character for an avatar initial, derived from {@link displayAuthorName}. */
export function authorAvatarInitial(
  author: AuthorLike,
  t: (key: TranslationKey) => string,
): string {
  return displayAuthorName(author, t).charAt(0).toUpperCase();
}
