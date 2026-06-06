/**
 * SSRF IP-classification primitives for takos.
 *
 * The classifier body is NOT defined here anymore. It is owned by the lowest
 * shared module — `takosumi-contract/reference/ip-classification` — so the one
 * in-process worker (takos egress / web-fetch / MCP validation, the git
 * container, the deploy-control host blocklist, and the OpenTofu runner) all
 * classify against a single set of ranges and cannot drift. takos worker code
 * imports the canonical module through the `takosumi-contract/reference/*`
 * tsconfig alias.
 *
 * This file remains only as the boundary-stable re-export the standalone git
 * container imports by relative path: the container's Docker image copies both
 * `takos/src/contracts` and `takosumi/`, so a relative re-export resolves
 * without the container needing the takosumi reference alias.
 */

export {
  isIpv4Literal,
  isPrivateIP,
  isPrivateIpv4,
  isPrivateIpv6Groups,
  parseIpv6,
} from "../../../../takosumi/packages/schema/src/reference/ip-classification.ts";
