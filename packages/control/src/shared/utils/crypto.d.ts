export interface EncryptedData {
    ciphertext: string;
    iv: string;
    alg: 'AES-256-GCM';
    v: 1;
}
export declare function encrypt(plaintext: string, masterSecret: string, salt: string): Promise<EncryptedData>;
export declare function decrypt(encrypted: EncryptedData, masterSecret: string, salt: string): Promise<string>;
export declare function encryptEnvVars(envVars: Record<string, string>, masterSecret: string, salt: string): Promise<string>;
export declare function decryptEnvVars(encryptedJson: string, masterSecret: string, salt: string): Promise<Record<string, string>>;
export declare function maskEnvVars(envVars: Record<string, string>): Record<string, string>;
//# sourceMappingURL=crypto.d.ts.map