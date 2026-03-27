// Barrel re-export — keeps the original import path working for all consumers.

export { CustomDomainError } from './custom-domains/types';
export type {
  DomainStatus,
  DnsInstruction,
  AddCustomDomainBody,
  AddCustomDomainResult,
  VerifyDomainSuccessBody,
  VerifyDomainErrorBody,
  VerifyCustomDomainResult,
  ServiceInfo,
} from './custom-domains/types';

export { deleteCloudflareCustomHostname, getCloudflareCustomHostnameStatus } from './custom-domains/cloudflare';

export {
  listCustomDomains,
  addCustomDomain,
  deleteCustomDomain,
} from './custom-domains/domain-crud';

export {
  verifyCustomDomain,
  getCustomDomainDetails,
  refreshSslStatus,
} from './custom-domains/domain-verification';
