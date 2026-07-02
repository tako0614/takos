# OIDC Consumer

Installed apps can consume the Takosumi issuer when the operator account plane has projected an OIDC client
for that app. This is an installed-service identity projection, not a generic third-party login marketplace.

## Current Flow

1. Install an app Capsule from Git and review/apply the Takosumi plan.
2. The account plane records the OIDC client projection for that Capsule/app when the operator policy allows it.
3. Takos shows the app in the Workspace with the projected sign-in material.
4. Revocation and rotation are handled by the account plane and recorded as audit evidence.
5. Generic third-party consent/client registry behavior is out of scope until that product surface is explicitly built.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

## Install Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A `plan` type Run records the plan to review; an `apply` type Run references the approved plan and records StateVersion
and Output on success. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow
instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Public Hosted Availability

OIDC clients for public hosted installs are opened by the operator account plane
only after operator approval. Until public hosted access is opened, the same
OIDC flow can be verified in operator rehearsal or self-host environments; new
public signups stay closed.
