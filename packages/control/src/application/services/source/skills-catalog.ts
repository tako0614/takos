import type { D1Database } from "../../../shared/types/bindings.ts";
import {
  formatSkill,
  getOfficialSkillById,
  getSkillAvailabilityDetails,
  listAvailableOfficialSkillContexts,
  listLocalizedOfficialSkills,
  resolveSkillLocale,
  type SkillLocaleInput,
  toAvailableOfficialSkill,
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
        listLocalizedOfficialSkills(locale).map(toAvailableOfficialSkill),
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
        listLocalizedOfficialSkills(locale).map(toAvailableOfficialSkill),
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

export async function listOfficialSkillsCatalog(
  db: D1Database,
  spaceId: string,
  localeInput?: SkillLocaleInput,
) {
  const locale = resolveSkillLocale(localeInput);
  const officialSkills = await listAvailableOfficialSkillContexts(
    db,
    spaceId,
    locale,
  );
  return {
    locale,
    skills: officialSkills.map((skill) => ({
      ...toSkillCatalogEntry(skill),
      editable: false,
      enabled: true,
    })),
  };
}

export async function getOfficialSkillCatalogEntry(
  db: D1Database,
  spaceId: string,
  skillId: string,
  localeInput?: SkillLocaleInput,
) {
  const locale = resolveSkillLocale(localeInput);
  const skill = getOfficialSkillById(skillId, locale);
  if (!skill) {
    return null;
  }

  const availability = await getSkillAvailabilityDetails(db, spaceId);
  const [withAvailability] = applySkillAvailability(
    [toAvailableOfficialSkill(skill)],
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
    source?: "official" | "custom";
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

  if (input.source === "official") {
    const officialSkill = await getOfficialSkillCatalogEntry(
      db,
      spaceId,
      ref,
      localeInput,
    );
    if (!officialSkill) {
      throw new Error(`Official skill not found: ${ref}`);
    }
    return officialSkill;
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

  const officialSkill = await getOfficialSkillCatalogEntry(
    db,
    spaceId,
    ref,
    localeInput,
  );
  if (officialSkill) {
    return officialSkill;
  }

  const customSkill = await getSkill(db, spaceId, ref) ??
    await getSkillByName(db, spaceId, ref);
  if (customSkill) {
    return formatSkill(customSkill);
  }

  throw new Error(`Skill not found: ${ref}`);
}
