export function getSkillInstructionByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export type SkillResourceSelectionError = "duplicate" | "too_many" | null;

export function validateSkillResourceSelection(
  resourceIds: string[],
  maximum: number,
): SkillResourceSelectionError {
  if (resourceIds.length > maximum) return "too_many";
  if (new Set(resourceIds).size !== resourceIds.length) return "duplicate";
  return null;
}
