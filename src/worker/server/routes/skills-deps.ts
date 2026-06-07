import { getSpaceOperationPolicy } from "../../application/tools/tool-policy.ts";

export const SKILL_LIST_ROLES =
  getSpaceOperationPolicy("skill.list").allowed_roles;
export const SKILL_GET_ROLES =
  getSpaceOperationPolicy("skill.get").allowed_roles;
export const SKILL_CREATE_ROLES =
  getSpaceOperationPolicy("skill.create").allowed_roles;
export const SKILL_UPDATE_ROLES =
  getSpaceOperationPolicy("skill.update").allowed_roles;
export const SKILL_TOGGLE_ROLES =
  getSpaceOperationPolicy("skill.toggle").allowed_roles;
export const SKILL_DELETE_ROLES =
  getSpaceOperationPolicy("skill.delete").allowed_roles;
export const SKILL_CONTEXT_ROLES =
  getSpaceOperationPolicy("skill.context").allowed_roles;
export const SKILL_DESCRIBE_ROLES =
  getSpaceOperationPolicy("skill.describe").allowed_roles;
