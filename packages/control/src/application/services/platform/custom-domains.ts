// Barrel re-export — keeps the original import path working for all consumers.

export { CustomDomainError } from "./custom-domains/domain-models.ts";
export type {
  AddCustomDomainBody,
  AddCustomDomainResult,
  DnsInstruction,
  DomainStatus,
  ServiceInfo,
  VerifyCustomDomainResult,
  VerifyDomainErrorBody,
  VerifyDomainSuccessBody,
} from "./custom-domains/domain-models.ts";

export {
  createManagedCustomHostname,
  deleteManagedCustomHostname,
  getManagedCustomHostnameStatus,
  resolveCustomHostnameProviderName,
} from "./custom-domains/custom-hostname-provider.ts";
export {
  deleteCloudflareCustomHostname,
  getCloudflareCustomHostnameStatus,
} from "./custom-domains/cloudflare.ts";
export type {
  CreateCustomHostnameResult,
  CustomHostnameProviderName,
  CustomHostnameStatus,
} from "./custom-domains/custom-hostname-provider.ts";

export {
  addCustomDomain,
  deleteCustomDomain,
  listCustomDomains,
} from "./custom-domains/domain-crud.ts";

export {
  getCustomDomainDetails,
  refreshSslStatus,
  verifyCustomDomain,
} from "./custom-domains/domain-verification.ts";
