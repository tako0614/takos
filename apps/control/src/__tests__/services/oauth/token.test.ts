import { beforeAll, describe, expect, it } from 'vitest';
import * as jose from 'jose';
import { generateAccessToken, verifyAccessToken } from '@/services/oauth/token';

describe('verifyAccessToken audience enforcement (issue 008)', () => {
  const issuer = 'https://admin.takos.test';
  const userId = 'user-1';
  const tokenAudience = 'client-a';
  const mismatchedAudience = 'client-b';

  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    privateKeyPem = await jose.exportPKCS8(privateKey);
    publicKeyPem = await jose.exportSPKI(publicKey);
  });

  async function issueAccessToken(clientId = tokenAudience): Promise<string> {
    const { token } = await generateAccessToken({
      privateKeyPem,
      issuer,
      userId,
      clientId,
      scope: 'openid profile',
    });
    return token;
  }

  it('returns payload when expectedAudience matches token audience', async () => {
    const token = await issueAccessToken(tokenAudience);

    const payload = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer,
      expectedAudience: tokenAudience,
    });

    expect(payload).not.toBeNull();
    expect(payload?.aud).toBe(tokenAudience);
    expect(payload?.client_id).toBe(tokenAudience);
  });

  it('returns null when expectedAudience mismatches token audience', async () => {
    const token = await issueAccessToken(tokenAudience);

    const payload = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer,
      expectedAudience: mismatchedAudience,
    });

    expect(payload).toBeNull();
  });

  it('returns payload when expectedAudience is omitted', async () => {
    const token = await issueAccessToken(tokenAudience);

    const payload = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer,
    });

    expect(payload).not.toBeNull();
    expect(payload?.aud).toBe(tokenAudience);
    expect(payload?.client_id).toBe(tokenAudience);
  });
});
