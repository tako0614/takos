// Barrel re-export — keeps the original import path working for all consumers.

export { CustomDomainError } from './custom-domains/domain-models.ts';
export type {
  DomainStatus,
  DnsInstruction,
  AddCustomDomainBody,
  AddCustomDomainResult,
  VerifyDomainSuccessBody,
  VerifyDomainErrorBody,
  VerifyCustomDomainResult,
  ServiceInfo,
} from './custom-domains/domain-models.ts';

export { deleteCloudflareCustomHostname, getCloudflareCustomHostnameStatus } from './custom-domains/cloudflare.ts';

export {
  listCustomDomains,
  addCustomDomain,
  deleteCustomDomain,
} from './custom-domains/domain-crud.ts';

export {
  verifyCustomDomain,
  getCustomDomainDetails,
  refreshSslStatus,
} from './custom-domains/domain-verification.ts';
