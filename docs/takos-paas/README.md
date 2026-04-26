# Takos Deploy v2 Final Specification Kit

This kit is the final-form architecture package for Takos Deploy v2.

The design goal is simple:

```text
Takos Deploy v2 is not a cloud abstraction layer.
It is a deployment meaning system.
```

Takos Core owns meaning and safety. ProviderPackages own typed native power and materialization.

## Documents

1. `01-core-kernel.md`  
   The small core: AppSpec, EnvSpec, PolicySpec, Plan, Apply, AppRelease, NetworkConfig, RuntimeNetworkPolicy, ActivationRecord, ResourceInstance, and ProviderMaterialization.

2. `02-registry-and-packages.md`  
   ProviderPackage, ResourceContractPackage, DataContractPackage, NativeSchema, PackageResolution, trust, revocation, conformance, provider targets, and provider-native configuration.

3. `03-operational-semantics.md`  
   RolloutRun, ChangeSetPlan, DependencyGraph, operation semantics, scoped locks, phase-boundary revalidation, canary side effects, shadow traffic, repair, restore, GC, and audit.

4. `04-runtime-contracts.md`  
   Worker, container, job, event subscriptions, Direct Workload Deploy, bindings, service identity, resource access, and readiness.

5. `05-security-supply-chain.md`  
   ProviderPackage execution isolation, credential boundaries, SupplyChainRecord, artifact mirroring, trust revocation, egress enforcement, secret resolution, redaction, and audit requirements.

6. `06-acceptance-tests.md`  
   Test catalog for Plan, Apply, Activation, resource contracts, provider-native materialization, canary side effects, multi-group dependencies, security, rollback, restore, and GC.

7. `takos-deploy-v2-final-architecture-contract.md`  
   A combined single-file version of the same specification.

## Design compass

```text
AppSpec declares app meaning.
EnvSpec binds meaning to an environment.
PolicySpec constrains meaning.
ResourceContractPackages define durable resource meaning.
DataContractPackages define payload meaning.
ProviderPackages materialize meaning into real infrastructure.
PackageResolution pins refs to digests.
Plan computes safe change.
Apply executes change with scoped locks and phase revalidation.
AppRelease owns runtime revisions.
NetworkConfig owns HTTP ingress.
RuntimeNetworkPolicy owns workload-scoped egress and service identity.
ActivationRecord records desired HTTP serving assignment.
ResourceInstance carries durable state.
ProviderMaterialization records where Takos tried to make infrastructure real.
Observed provider state is never canonical.
```
