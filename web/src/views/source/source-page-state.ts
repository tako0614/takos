import { findSpaceByIdentifier, getSpaceIdentifier } from "../../lib/spaces.ts";
import type { Space } from "../../types/index.ts";

export function resolveSourceSpaceId(
  spaces: readonly Space[],
  selectedSpaceId?: string,
): string | null {
  const selected = selectedSpaceId
    ? findSpaceByIdentifier([...spaces], selectedSpaceId)
    : null;
  const identifier = selected
    ? getSpaceIdentifier(selected)
    : spaces[0]
    ? getSpaceIdentifier(spaces[0])
    : "";
  return identifier || null;
}
