import { logError } from "../../../../shared/utils/logger.ts";
import {
  DNS_RESOLVE_TIMEOUT_MS,
  DOH_ENDPOINT,
} from "../../../../shared/constants/dns.ts";

export function normalizeDnsAnswer(value: string): string {
  return value.trim().replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase();
}

export function customDomainVerificationRecord(
  domain: string,
  method: "cname" | "txt",
): { recordName: string; dnsType: "CNAME" | "TXT" } {
  return method === "cname"
    ? { recordName: `_acme-challenge.${domain}`, dnsType: "CNAME" }
    : { recordName: `_takos-verify.${domain}`, dnsType: "TXT" };
}

export function dnsAnswerMatches(
  answer: string,
  expectedValue: string,
  method: "cname" | "txt",
): boolean {
  const expected = method === "txt"
    ? `takos-verify=${expectedValue}`
    : expectedValue;
  return normalizeDnsAnswer(answer) === normalizeDnsAnswer(expected);
}

export async function verifyDNS(
  domain: string,
  expectedValue: string,
  method: "cname" | "txt",
): Promise<{ verified: boolean; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DNS_RESOLVE_TIMEOUT_MS,
  );

  try {
    const { recordName, dnsType } = customDomainVerificationRecord(
      domain,
      method,
    );

    const response = await fetch(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(recordName)}&type=${dnsType}`,
      {
        headers: {
          "Accept": "application/dns-json",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return { verified: false, error: "DNS query failed" };
    }

    const data = await response.json() as {
      Status: number;
      Answer?: Array<{ data: string }>;
    };

    if (data.Status !== 0 || !data.Answer) {
      return { verified: false, error: "No DNS record found" };
    }

    for (const answer of data.Answer) {
      if (dnsAnswerMatches(answer.data, expectedValue, method)) {
        return { verified: true };
      }
    }

    return {
      verified: false,
      error: "Verification record not found or incorrect",
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { verified: false, error: "DNS query timed out" };
    }
    logError("DNS verification error", err, {
      module: "services/platform/custom-domains",
    });
    return { verified: false, error: "DNS verification failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}
