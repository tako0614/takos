import { describe, expect, test } from "bun:test";

import {
  NATIVE_ABSENCE_VERIFICATION_KIND,
  NATIVE_ABSENCE_VERIFIER_ID,
  NATIVE_ABSENCE_VERIFIER_INPUT_KIND,
  NATIVE_ABSENCE_VERIFIER_RESULT_KIND,
  NATIVE_RESOURCE_KEYS,
  TAKOSERVER_API_ORIGIN_ENV,
  TAKOSERVER_EVIDENCE_API_TOKEN_ENV,
  TAKOSERVER_ORGANIZATION_ID_ENV,
  buildNativeAbsenceVerifierResult,
  buildNativeResidualURL,
  parseNativeAbsenceVerifierInput,
  parseVerifierArgs,
  parseNativeResidualResponse,
  parseProjectedResourceIdentities,
  serializeNativeAbsenceEvidence,
  serializeNativeAbsenceVerifierResult,
  verifyNativeAbsence,
  type FetchFunction,
  type NativeAbsenceResponse,
} from "../takoserver-native-absence-verifier.ts";

const host = "https://api.takoserver.example";
const organizationId = "org_example";
const space = "space-a";
const token = "reader-token-that-must-not-escape";
const scriptDigest = `sha256:${"b".repeat(64)}`;

function projectedIdentities(options: {
  readonly duplicateUid?: boolean;
  readonly missingKey?: boolean;
  readonly wrongSpace?: boolean;
  readonly extraKey?: boolean;
} = {}): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  NATIVE_RESOURCE_KEYS.forEach((key, index) => {
    if (options.missingKey && key === "worker_endpoint") return;
    value[key] = {
      name: `native-proof-${key.replaceAll("_", "-")}`,
      space: options.wrongSpace ? "other-space" : space,
      uid: options.duplicateUid && index === 4 ? "uid-0" : `uid-${index}`,
    };
  });
  if (options.extraKey) value.extra = { name: "extra", space, uid: "uid-extra" };
  return value;
}

function projectedOutput(value: unknown = projectedIdentities()): Record<string, unknown> {
  return {
    resource_identities: {
      sensitive: false,
      type: ["map", "object"],
      value,
    },
  };
}

function verifierInput(value: unknown = projectedOutput()): Record<string, unknown> {
  return {
    kind: NATIVE_ABSENCE_VERIFIER_INPUT_KIND,
    verifierId: NATIVE_ABSENCE_VERIFIER_ID,
    scriptDigest,
    context: {
      capsuleId: "capsule-1",
      destroyPlanRunId: "plan-1",
      destroyApplyRunId: "apply-1",
    },
    publicOutputs: value,
  };
}

function residual(status: "absent" | "present" | "indeterminate" = "absent"): NativeAbsenceResponse {
  return {
    residual: {
      status,
      source: "provider",
      effectCount: 2,
      deploymentCount: 1,
      checkedAt: "2026-08-31T00:00:00.000Z",
      ...(status === "absent" ? { evidenceRef: `sha256:${"a".repeat(64)}` } : {}),
      ...(status === "indeterminate" ? { reason: "effect_unresolved" } : {}),
    },
  };
}

describe("Takoserver native absence verifier", () => {
  test("parses the projected OpenTofu resource identity map with exactly five unique UIDs", () => {
    const identities = parseProjectedResourceIdentities(projectedOutput());
    expect(Object.keys(identities).sort()).toEqual([...NATIVE_RESOURCE_KEYS].sort());
    expect(new Set(Object.values(identities).map((identity) => identity.uid)).size).toBe(5);
    expect(identities.worker_endpoint).toEqual({
      name: "native-proof-worker-endpoint",
      space,
      uid: "uid-4",
    });
  });

  test("rejects missing, extra, duplicate, wrong-space, and malformed identities", () => {
    expect(() => parseProjectedResourceIdentities(projectedOutput(projectedIdentities({ missingKey: true })))).toThrow(/exactly five/u);
    expect(() => parseProjectedResourceIdentities(projectedOutput(projectedIdentities({ extraKey: true })))).toThrow(/exactly five|unexpected/u);
    expect(() => parseProjectedResourceIdentities(projectedOutput(projectedIdentities({ duplicateUid: true })))).toThrow(/distinct|unique/u);
    expect(() => parseProjectedResourceIdentities(projectedOutput(projectedIdentities({ wrongSpace: true })), space)).toThrow(/space/u);
    expect(() => parseProjectedResourceIdentities({ resource_identities: { sensitive: true, type: ["map", "object"], value: projectedIdentities() } })).toThrow(/sensitive/u);
    expect(() => parseProjectedResourceIdentities({ resource_identities: { sensitive: false, type: ["map", "object"], value: projectedIdentities(), extra: true } })).toThrow(/exactly five|unexpected/u);
    expect(() => parseProjectedResourceIdentities({ resource_identities: { sensitive: false, type: ["map", "object"], value: { ...projectedIdentities(), module_worker: { name: "n", space, uid: "../bad" } } } })).toThrow(/uid/u);
  });

  test("builds the exact organization native-residual URL and does not put credentials in it", () => {
    const url = buildNativeResidualURL({
      host,
      organizationId,
      resourceUid: "uid-0",
      space,
      name: "native-proof-module-worker",
    });
    expect(url.toString()).toBe(
      `${host}/v1/organizations/${organizationId}/resources/uid-0/native-residual?space=space-a&name=native-proof-module-worker`,
    );
    expect(url.toString()).not.toContain(token);
    expect(() => buildNativeResidualURL({
      host: "http://localhost:8787",
      organizationId,
      resourceUid: "uid-0",
      space,
      name: "native-proof-module-worker",
    })).toThrow(/HTTPS/u);
  });

  test("accepts only the closed host input and emits the closed child result", () => {
    const input = parseNativeAbsenceVerifierInput(verifierInput());
    expect(input.scriptDigest).toBe(scriptDigest);
    expect(input.context.destroyApplyRunId).toBe("apply-1");
    expect(() => parseNativeAbsenceVerifierInput({ ...verifierInput(), extra: true })).toThrow(/unexpected/u);
    expect(() => parseNativeAbsenceVerifierInput({ ...verifierInput(), verifierId: "other@v1" })).toThrow(/verifierId/u);
    expect(() => parseNativeAbsenceVerifierInput({ ...verifierInput(), scriptDigest: "native-id" })).toThrow(/digest/u);

    const result = buildNativeAbsenceVerifierResult(scriptDigest);
    expect(result).toEqual({
      kind: NATIVE_ABSENCE_VERIFIER_RESULT_KIND,
      verifierId: NATIVE_ABSENCE_VERIFIER_ID,
      scriptDigest,
      checks: NATIVE_RESOURCE_KEYS.map((name) => ({ name, status: "passed" })),
    });
    expect(Object.keys(result).sort()).toEqual(["checks", "kind", "scriptDigest", "verifierId"]);
    expect(serializeNativeAbsenceVerifierResult(result)).not.toContain(token);
    expect(() => serializeNativeAbsenceVerifierResult({ ...result, checks: [...result.checks].reverse() })).toThrow(/order/u);
  });

  test("requires the fixed input form and allowlisted Takoserver environment", () => {
    const environment = {
      [TAKOSERVER_API_ORIGIN_ENV]: host,
      [TAKOSERVER_ORGANIZATION_ID_ENV]: organizationId,
      [TAKOSERVER_EVIDENCE_API_TOKEN_ENV]: token,
    };
    expect(parseVerifierArgs(["--input-file", "input.json"], environment)).toEqual({
      host,
      organizationId,
      inputFile: "input.json",
      timeoutMs: 30_000,
    });
    expect(() => parseVerifierArgs([], environment)).toThrow(/input-file/u);
    expect(() => parseVerifierArgs(["--token", token], environment)).toThrow(/unknown/u);
    expect(() => parseVerifierArgs(["--host", host], environment)).toThrow(/unknown/u);
    expect(() => parseVerifierArgs(["--input-file", "input.json", "other.json"], environment)).toThrow(/unknown/u);
    expect(() => parseVerifierArgs(["--input-file", "input.json"], { ...environment, [TAKOSERVER_EVIDENCE_API_TOKEN_ENV]: "" })).toThrow(/environment/u);
  });

  test("accepts only a closed absent response", () => {
    expect(parseNativeResidualResponse(residual())).toMatchObject({ status: "absent", source: "provider" });
    expect(() => parseNativeResidualResponse(residual("present"))).toThrow(/absent/u);
    expect(() => parseNativeResidualResponse(residual("indeterminate"))).toThrow(/absent/u);
    expect(() => parseNativeResidualResponse({ ...residual(), extra: true })).toThrow(/envelope|unexpected/u);
    expect(() => parseNativeResidualResponse({ residual: { ...residual().residual, effectCount: -1 } })).toThrow(/effectCount/u);
    expect(() => parseNativeResidualResponse({ residual: { ...residual().residual, evidenceRef: "native-id-secret" } })).toThrow(/evidenceRef/u);
  });

  test("queries all five UIDs, aggregates failures, and emits bounded nonsecret evidence", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const fetchImpl: FetchFunction = async (input, init) => {
      requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(residual()), {
        status: 200,
        headers: { "cache-control": "no-store", "content-type": "application/json" },
      });
    };
    const evidence = await verifyNativeAbsence({
      host,
      organizationId,
      projectedOutput: projectedOutput(),
      token,
      timeoutMs: 100,
      fetchImpl,
    });
    expect(requests).toHaveLength(5);
    expect(requests.map(({ url }) => url)).toEqual(
      [...NATIVE_RESOURCE_KEYS].map((key, index) =>
        `${host}/v1/organizations/${organizationId}/resources/uid-${index}/native-residual?space=${space}&name=native-proof-${key.replaceAll("_", "-")}`,
      ),
    );
    expect(requests.every(({ authorization }) => authorization === `Bearer ${token}`)).toBe(true);
    expect(evidence).toMatchObject({ kind: NATIVE_ABSENCE_VERIFICATION_KIND, status: "passed", space, checkedCount: 5 });
    const serialized = serializeNativeAbsenceEvidence(evidence);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("native-id");
    expect(serialized.length).toBeLessThan(16_384);
  });

  test("continues through auth, 404, 503, present, and indeterminate responses before failing", async () => {
    const statuses = [401, 404, 503, 200, 200];
    const bodies = [
      "auth failure with token",
      JSON.stringify({ error: { code: "not_found", message: "raw internal detail" } }),
      JSON.stringify({ error: { code: "backend_unavailable" } }),
      JSON.stringify(residual("present")),
      JSON.stringify(residual("indeterminate")),
    ];
    let calls = 0;
    const result = verifyNativeAbsence({
      host,
      organizationId,
      space,
      projectedOutput: projectedOutput(),
      token,
      timeoutMs: 100,
      fetchImpl: async () => {
        const index = calls++;
        return new Response(bodies[index], { status: statuses[index] });
      },
    });
    await expect(result).rejects.toThrow(/five|failed|absence/u);
    try {
      await result;
    } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain("raw internal detail");
      expect(String(error)).not.toContain("native-id");
    }
    expect(calls).toBe(5);
  });

  test("rejects a timeout and still attempts every identity", async () => {
    let calls = 0;
    await expect(verifyNativeAbsence({
      host,
      organizationId,
      space,
      projectedOutput: projectedOutput(),
      token,
      timeoutMs: 10,
      fetchImpl: async (_input, init) => {
        calls += 1;
        await new Promise<void>((resolve) => {
          init?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("provider timeout with native-id-secret");
      },
    })).rejects.toThrow(/failed|timeout|deadline/u);
    expect(calls).toBe(5);
  });

  test("rejects duplicate JSON members in an otherwise successful response", async () => {
    const body = `{"residual":${JSON.stringify(residual().residual)},"residual":${JSON.stringify(residual().residual)}}`;
    let calls = 0;
    await expect(verifyNativeAbsence({
      host,
      organizationId,
      projectedOutput: projectedOutput(),
      token,
      timeoutMs: 100,
      fetchImpl: async () => {
        calls += 1;
        return new Response(body, { status: 200 });
      },
    })).rejects.toThrow(/failed|duplicate|malformed/u);
    expect(calls).toBe(5);
  });
});
