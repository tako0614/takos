# Descriptor Authoring Guide v1.0

Descriptors define meaning. They are dictionaries, not programs.

## Core rules

```text
1. Descriptor identity is a canonical URI.
2. Authoring aliases are conveniences only.
3. Descriptor content must be digest-pinned in the Shape/provider metadata
   recorded for a Deployment.
4. Compatibility descriptor projections must retain the full descriptor closure.
5. Descriptor rules must be declarative.
6. Provider capability descriptors must not redefine contract semantics.
```

## Naming

```text
Canonical URI:
  https://takosumi.com/contracts/<domain>/<name>/v<major>

Authoring alias:
  <domain>.<name>@v<major>
```

Good:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
resource.sql.postgres@v1
publication.mcp-server@v1
```

Avoid provider identity inside contract names:

```text
cloudrun.container@v1
neon.postgres.managed@v1
cloudflare-d1-db@v1
```

## JSON-LD

Descriptors MAY be JSON-LD. If JSON-LD is used:

```text
@id is canonical identity
@context inputs must be digest-pinned
expanded/canonical digest must be recorded if semantic comparison depends on expansion
Apply must not re-fetch remote contexts
```

## Field-level change effects

Descriptors with config fields SHOULD define field-level change effects. If
omitted, the contract-level changeEffect is used as fallback and resolution
SHOULD warn through a `Deployment.conditions[]` entry.

## Exposure eligibility

Descriptors that can be targeted by exposures MUST declare
exposureEligible=true.
