/**
 * Artifact access and cryptographic helpers for deployments.
 *
 * Handles reading bundle/wasm content from object storage, verifying
 * integrity hashes, and encrypting/decrypting env-vars and bindings
 * snapshots.
 */
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { Deployment, DeploymentEnv } from './models';
export declare function getBundleContent(env: DeploymentEnv, deployment: Deployment): Promise<string>;
export declare function verifyBundleIntegrity(bundleContent: string, deployment: Deployment): Promise<void>;
export declare function getWasmContent(env: DeploymentEnv, deployment: Deployment): Promise<ArrayBuffer | null>;
export declare function decryptBindings(encryptionKey: string, deployment: Deployment): Promise<WorkerBinding[]>;
export declare function getEnvVars(encryptionKey: string, deployment: Deployment): Promise<Record<string, string>>;
export declare function getMaskedEnvVars(encryptionKey: string, deployment: Deployment): Promise<Record<string, string>>;
//# sourceMappingURL=artifact-io.d.ts.map