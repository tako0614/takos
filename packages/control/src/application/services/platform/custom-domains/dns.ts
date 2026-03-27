import { logError } from '../../../../shared/utils/logger';

export async function verifyDNS(
  domain: string,
  expectedValue: string,
  method: 'cname' | 'txt'
): Promise<{ verified: boolean; error?: string }> {
  try {
    const recordName = method === 'cname'
      ? `_acme-challenge.${domain}`
      : `_takos-verify.${domain}`;

    const dnsType = method === 'cname' ? 'CNAME' : 'TXT';

    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(recordName)}&type=${dnsType}`,
      {
        headers: {
          'Accept': 'application/dns-json',
        },
      }
    );

    if (!response.ok) {
      return { verified: false, error: 'DNS query failed' };
    }

    const data = await response.json() as {
      Status: number;
      Answer?: Array<{ data: string }>;
    };

    if (data.Status !== 0 || !data.Answer) {
      return { verified: false, error: 'No DNS record found' };
    }

    for (const answer of data.Answer) {
      const value = answer.data.replace(/^"|"$/g, '').toLowerCase();
      if (method === 'cname') {
        if (value.includes(expectedValue.toLowerCase())) {
          return { verified: true };
        }
      } else {
        if (value.includes(`takos-verify=${expectedValue.toLowerCase()}`)) {
          return { verified: true };
        }
      }
    }

    return { verified: false, error: 'Verification record not found or incorrect' };
  } catch (err) {
    logError('DNS verification error', err, { module: 'services/platform/custom-domains' });
    return { verified: false, error: 'DNS verification failed' };
  }
}
