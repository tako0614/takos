import type { D1Database } from '../../../shared/types/bindings.ts';
import type { OAuthDeviceCode } from '../../../shared/types/oauth';
export declare function normalizeUserCode(raw: string): string;
export interface CreatedDeviceAuthorization {
    id: string;
    deviceCode: string;
    userCode: string;
    expiresIn: number;
    interval: number;
    expiresAt: string;
}
export declare function createDeviceAuthorization(dbBinding: D1Database, params: {
    clientId: string;
    scope: string;
    expiresInSeconds?: number;
    intervalSeconds?: number;
}): Promise<CreatedDeviceAuthorization>;
export declare function getDeviceAuthorizationByUserCode(dbBinding: D1Database, rawUserCode: string): Promise<OAuthDeviceCode | null>;
export declare function getDeviceAuthorizationByDeviceCode(dbBinding: D1Database, deviceCode: string): Promise<OAuthDeviceCode | null>;
export declare function approveDeviceAuthorization(dbBinding: D1Database, params: {
    id: string;
    userId: string;
}): Promise<boolean>;
export declare function denyDeviceAuthorization(dbBinding: D1Database, params: {
    id: string;
    userId: string;
}): Promise<boolean>;
export type DeviceCodePollResult = {
    kind: 'not_found';
} | {
    kind: 'client_mismatch';
} | {
    kind: 'expired';
} | {
    kind: 'denied';
} | {
    kind: 'used';
} | {
    kind: 'pending';
    slowDown: boolean;
    intervalSeconds: number;
} | {
    kind: 'approved';
    id: string;
    userId: string;
    scope: string;
};
export declare function pollDeviceAuthorization(dbBinding: D1Database, params: {
    deviceCode: string;
    clientId: string;
}): Promise<DeviceCodePollResult>;
export declare function consumeApprovedDeviceAuthorization(dbBinding: D1Database, id: string): Promise<boolean>;
//# sourceMappingURL=device.d.ts.map