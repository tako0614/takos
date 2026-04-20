import type { D1Database } from "../../../shared/types/bindings.ts";
import {
  formatSkill,
  getManagedSkillById,
  getSkillAvailabilityDetails,
  listAvailableManagedSkillContexts,
  listLocalizedManagedSkills,
  resolveSkillLocale,
  type SkillLocaleInput,
  toAvailableManagedSkill,
  toSkillCatalogEntry,
} from "./skills-shared.ts";
import { applySkillAvailability, type SkillContext } from "../agent/skills.ts";
import {
  getSkill,
  getSkillByName,
  listEnabledCustomSkillContext,
} from "./skills-custom.ts";

export async function listDetailedSkillContext(
  db: D1Database,
  spaceId: string,
  localeInput?: SkillLocaleInput,
  availableToolNames: string[] = [],
): Promise<{ locale: string; skills: SkillContext[] }> {
  const locale = resolveSkillLocale(localeInput);
  const [customSkills, availability] = await Promise.all([
    listEnabledCustomSkillContext(db, spaceId),
    getSkillAvailabilityDetails(db, spaceId),
  ]);

  return {
    locale,
    skills: [
      ...applySkillAvailability(
        listLocalizedManagedSkills(locale).map(toAvailableManagedSkill),
        {
          ...availability,
          availableToolNames,
        },
      ),
      ...applySkillAvailability(customSkills, {
        ...availability,
        availableToolNames,
      }),
    ],
  };
}

export async function listSkillCatalog(
  db: D1Database,
  spaceId: string,
  localeInput?: SkillLocaleInput,
): Promise<
  { locale: string; available_skills: ReturnType<typeof toSkillCatalogEntry>[] }
> {
  const locale = resolveSkillLocale(localeInput);
  const [customSkills, availability] = await Promise.all([
    listEnabledCustomSkillContext(db, spaceId),
    getSkillAvailabilityDetails(db, spaceId),
  ]);

  return {
    locale,
    available_skills: [
      ...applySkillAvailability(
        listLocalizedManagedSkills(locale).map(toAvailableManagedSkill),
        availability,
      ).map(toSkillCatalogEntry),
      ...applySkillAvailability(customSkills, availability).map(
        toSkillCatalogEntry,
      ),
    ],
  };
}

export async function listSkillContext(
  db: D1Database,
  spaceId: string,
  localeInput?: SkillLocaleInput,
) {
  return await listSkillCatalog(db, spaceId, localeInput);
}

export async function listManagedSkillsCatalog(
  db: D1Database,
  spaceId: string,
  localeInput?: SkillLocaleInput,
) {
  const locale = resolveSkillLocale(localeInput);
  const managedSkills = await listAvailableManagedSkillContexts(
    db,
    spaceId,
    locale,
  );
  return {
    locale,
    skills: managedSkills.map((skill) => ({
      ...toSkillCatalogEntry(skill),
      editable: false,
      enabled: true,
    })),
  };
}

export async function getManagedSkillCatalogEntry(
  db: D1Database,
  spaceId: string,
  skillId: string,
  localeInput?: SkillLocaleInput,
) {
  const locale = resolveSkillLocale(localeInput);
  const skill = getManagedSkillById(skillId, locale);
  if (!skill) {
    return null;
  }

  const availability = await getSkillAvailabilityDetails(db, spaceId);
  const [withAvailability] = applySkillAvailability(
    [toAvailableManagedSkill(skill)],
    availability,
  );
  return {
    ...toSkillCatalogEntry(withAvailability),
    instructions: withAvailability.instructions,
    editable: false,
    enabled: true,
  };
}

export async function describeAgentSkill(
  db: D1Database,
  spaceId: string,
  input: {
    source?: "managed" | "custom";
    skillId?: string;
    skillName?: string;
    skillRef?: string;
    locale?: string;
    acceptLanguage?: string | null;
  },
) {
  const ref = input.skillRef?.trim() || input.skillId?.trim() ||
    input.skillName?.trim() || "";
  if (!ref) {
    throw new Error("skill_ref, skill_id, or skill_name is required");
  }

  const localeInput = {
    preferredLocale: input.locale,
    acceptLanguage: input.acceptLanguage,
  };

  if (input.source === "managed") {
    const managedSkill = await getManagedSkillCatalogEntry(
      db,
      spaceId,
      ref,
      localeInput,
    );
    if (!managedSkill) {
      throw new Error(`Managed skill not found: ${ref}`);
    }
    return managedSkill;
  }

  if (input.source === "custom") {
    const customSkill = input.skillId
      ? await getSkill(db, spaceId, input.skillId)
      : await getSkillByName(db, spaceId, ref);
    if (!customSkill) {
      throw new Error(`Skill not found: ${ref}`);
    }
    return formatSkill(customSkill);
  }

  const managedSkill = await getManagedSkillCatalogEntry(
    db,
    spaceId,
    ref,
    localeInput,
  );
  if (managedSkill) {
    return managedSkill;
  }

  const customSkill = await getSkill(db, spaceId, ref) ??
    await getSkillByName(db, spaceId, ref);
  if (customSkill) {
    return formatSkill(customSkill);
  }

  throw new Error(`Skill not found: ${ref}`);
}
