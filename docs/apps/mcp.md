# MCP Server

MCP servers appear in Takos as tools that can be used from a Workspace. Users install a plain OpenTofu Capsule rather
than a Takos-specific MCP manifest. After a successful apply, Takosumi resolves the service-side `mcp.server`
`Interface` inputs from explicitly selected ordinary Outputs, and `InterfaceBinding` authorizes the caller. Takos reads
only that resolved, authorized view.

## Current Flow

1. Install a Git URL/ref that points at an OpenTofu Capsule.
2. Review the Takosumi `plan` Run and approve the saved plan.
3. A successful `apply` records StateVersion and Output.
4. A service-side `InstallConfig.interfaceBlueprints` entry materializes an `mcp.server` Interface whose
   `inputs.endpoint` explicitly selects the Capsule's ordinary endpoint Output. A module may instead declare its own
   Interface with the optional `takosumi_interface` resource.
5. A Ready `InterfaceBinding` authorizes the Principal for `mcp.invoke`; Takos then shows the server's tools in the
   Workspace tool catalog. Credentials are delivered only through a supported binding mechanism, never an Output.

Current first-party examples are normal removable Capsules:

- `takos-computer` publishes sandbox shell, file, and process tools;
- `takos-storage` publishes Workspace drive tools and separately exposes `storage.object` to app consumers;
- `takos-git` publishes repository-management tools and separately exposes `source.git.smart_http`.

Takos does not copy these tools into its static registry. Installing or removing the Capsule and its service-side
Interface adds or removes its MCP tools through the Takosumi Interface API.

Takosumi control operations use this same path when an operator chooses to expose them to agents. The producer is a
normal operator control MCP Capsule or host adapter with an `mcp.server` Interface and a Principal `mcp.invoke`
InterfaceBinding. The adapter authenticates the invocation-only Interface token, maps the live MCP operation onto the
same Takosumi public control service, and lets Takosumi re-evaluate Workspace RBAC, policy, saved-plan guards, Run/state,
and audit. Takos does not define fixed control tool names, and it does not inject a broad control API token into a
deployed workload. The exact blueprint and trust model are documented in
[Takos app Interfaces](/architecture/app-interface#takosumi-control-mcp-の具体的な配信モデル).

## Connections, not a Store

Takos treats MCP as an open connection surface, not as a catalog allowlist. The Connections view accepts any publicly
reachable HTTPS MCP server URL without embedded credentials on the default port, even when that server does not appear
in a configured registry. A provider can link to
`/connections/new?server=<encoded HTTPS URL>` to open the same review flow; the portable identifier in that link is the
server URL, not a Takos-only listing ID.

The same input also accepts an MCP Registry server ID or a search term. A Workspace can search the preview Official MCP
Registry together with organization, community, or custom registry-compatible sources. The Official source can be
disabled per Workspace; when disabled, Takos does not send that Workspace's search terms to it. Takos merges duplicate
remote endpoints and keeps every source as provenance on the result. Registry metadata is discovery metadata only: an
"official" source label does not mean that Takos or the MCP project has reviewed, approved, or made the connector safe.
The connection review therefore shows the actual endpoint host and data destination while marking the connector operator
and physical execution location unknown unless separate evidence establishes them.

The current registry integration is intentionally live and best-effort. It uses each upstream registry's name search
and does not maintain a cached full-text security index. Sources must currently be public HTTPS endpoints on the default
port. A Workspace editor may configure either a bearer credential or one safe custom header; the value is encrypted at
rest, omitted from every response, and sent only to that normalized Registry endpoint through Takos egress. Changing an
authenticated Registry host requires entering the credential again. Private-network Registry routing remains a later
capability. A failed custom source does not hide results from the other enabled sources. Literal endpoints that declare
required headers or variables are shown but cannot be connected until Takos has an explicit configuration flow for
those values. Remotes whose endpoint itself is a URL template are omitted because Takos cannot yet disclose their actual
execution and data-destination host.

A bare domain in the same input starts experimental SEP-2127 discovery. Takos reads
`https://<domain>/.well-known/mcp/catalog.json`, follows its explicit Server Card URLs without following HTTP redirects,
and accepts only the experimental v1 card media type and schema. Catalog and card documents are bounded, fetched through
Takos egress, and limited to public HTTPS locations. Server Card claims are advisory discovery metadata: selecting a
candidate still enters the normal MCP initialize, authorization, connection review, and live `tools/list` flow. This is
an experimental MCP extension rather than an accepted core MCP specification, so URL input and Registry search remain
the stable discovery paths.

Keep these three concepts separate in UI and contracts:

- **service**: the product the user ultimately wants to use, such as a document service;
- **connector**: the concrete MCP implementation and operator that receives data and talks to that service;
- **connection**: one Workspace's configured and, when required, authorized relationship with that connector.

Takos currently connects to external servers through MCP Streamable HTTP. It also displays npm and OCI package records
advertised by Registry metadata, including their version, digest, runtime hint, transport, and whether configuration is
required. Those packages are never executed merely because they appear in search results. When the record includes a
repository URL, Takos can open the normal Capsule planning flow with that Git URL, version/ref, and repository subfolder.
The repository must contain a compatible plain OpenTofu/Terraform module; package metadata alone is not an executable
Takos workload. Planning, applying, state, outputs, and audit therefore remain Takosumi-owned, and a successfully
projected MCP endpoint returns to the same Connections UX.

Connections can be exported as strict `takos.mcp.connections` version 1 JSON and imported into another Takos Workspace.
The portable document contains normalized MCP URLs, Registry source metadata, enabled state, requested OAuth scope, and
tool fingerprint/policy intent. It never contains OAuth access or refresh tokens, OAuth client credentials, Registry
credentials, confirmation arguments, or Takos-only catalog IDs. An imported authenticated Registry stays disabled until
its credential is entered again. Imported tool approvals are staged disabled and require review against the live
`tools/list`; importing a document cannot silently authorize a tool. Protected connections resume through the normal
OAuth flow and return authorization links to the user.

MCP tool names remain unchanged when they already satisfy the model provider's function-name contract and do not
collide. Invalid, overlong, or colliding names receive a stable, bounded server/tool suffix in the model-visible catalog;
Takos still calls the connector with its original MCP tool name. This prevents one connector from invalidating the whole
model request or shadowing a Takos/core tool.

Catalog ingestion is bounded before it reaches the run container: at most 64 enabled MCP servers participate in one
Run, each tool snapshot is limited to 128 KiB, each server catalog to 512 tools / 4 MiB, and the combined runtime catalog
to 2,048 tools / 8 MiB. An oversized server is rejected as a unit rather than leaving a partially exposed catalog.

The current Run protocol owns synchronous `tools/call` execution. A connector tool that declares
`execution.taskSupport: "required"` is shown as unsupported and is never exposed to the model, even if an older policy
row says enabled. Supporting it requires Takos to own MCP Task creation, durable polling, cancellation, and terminal
result recovery end to end; treating it as an ordinary synchronous call would lose those lifecycle guarantees.

## External authorization

Takos does not silently treat OAuth discovery failure as a public server. It first performs a bounded MCP
`initialize` handshake without a bearer token and, when the server advertises the tools capability, verifies
`tools/list`. Only that valid protocol exchange is accepted as a public, no-authorization connection.

For a protected server, Takos follows the MCP 2025-11-25 authorization flow: Protected Resource Metadata, OAuth or OIDC
authorization-server discovery, PKCE S256, and the resource indicator on authorization, token, and refresh requests.
OAuth client selection is, in order:

1. an operator preregistration for that exact resource or authorization server;
2. Takos's deployment-specific Client ID Metadata Document at `/api/mcp/client.json`;
3. Dynamic Client Registration;
4. an explicit manual-registration-required error.

Because one Takos deployment can connect to multiple authorization servers, a protected server's authorization server
must advertise RFC 9207 authorization-response issuer support. Takos opens authorization through an authenticated,
same-user start route, stores a high-entropy browser nonce encrypted, and carries it only in a short-lived HttpOnly
callback cookie. Takos accepts the callback only when both that browser binding and the exact `iss` value match. The
normal Takos session cookie remains `SameSite=Strict`; it is not weakened for OAuth callbacks.

Takos does not fall back to a made-up shared client ID. Access tokens, refresh tokens, and confidential client secrets
are encrypted at rest and are never returned by the MCP server-list API. A saved client registration is reused only for
the same authorization-server issuer and while its secret remains valid. OAuth callback persistence also binds the
token to the exact Workspace, connection name, and normalized MCP endpoint so a same-name endpoint change cannot receive
the token.

Authentication from the connector to an underlying service remains the connector operator's responsibility. Takos
authorizes itself to the MCP server; it does not accept an underlying service token for passthrough to that server.

## Tool exposure consent

Registry declarations are not the tool authority. Takos fetches the connection's current `tools/list` and fingerprints
each external tool's name, description, input/output schemas, behavior annotations, and execution contract. A first-seen
tool is disabled until a Workspace editor reviews it. If any fingerprinted field changes, the tool is disabled and
requires review again. The Connections view shows the server-provided annotations and Takos's risk/side-effect treatment,
but annotations alone are not a trust boundary.

The selected fingerprint is included when the user enables or disables a tool. Takos rejects a stale selection and
revalidates the enabled fingerprint and connection state immediately before execution, so a new schema, another
Workspace's policy, or a connection disabled after a Run started cannot inherit an earlier approval. Managed and
Capsule-published tools keep their existing Workspace policy and appear as read-only in this external-tool consent UI.

An enabled external tool also has an invocation policy. `confirm_each_time` is the default, including for rows upgraded
from an older release. Before the call, Takos revalidates the live schema and policy, then creates a ten-minute decision
bound to the exact Workspace, user, server, tool fingerprint, and canonical arguments. The requesting Run and thread are
recorded for traceability, but an approval can be consumed by the next exact retry even when the original Run has already
ended. Arguments are encrypted at rest and their lookup identity is keyed rather than a plaintext digest. The user can
approve or deny from the authenticated Takos UI; approval is one-time and is consumed before the remote attempt. A
Workspace editor may deliberately choose `automatic` for a reviewed tool when per-call confirmation is not desired.

That setting does not bypass Takos's high-risk boundary: a tool classified `high` or advertising
`destructiveHint: true` requires a one-time user decision even when it comes from a managed local server or a
Capsule-published MCP server, and even when an external tool was otherwise set to `automatic`. Takos revalidates the
live tool fingerprint before consuming that decision. Explicitly allowlisted local read-only tools continue to run
without this prompt.

MCP descriptions and results, Web content, repository files, documents, retrieved memory, and all other tool output are
untrusted data in the agent system prompt. Embedded instructions cannot change the user's goal, grant capabilities, or
count as confirmation. Destructive or high-risk transitions must follow user-originated intent and any confirmation
required by Takos; the agent must not infer approval from retrieved content, another agent, or the MCP server itself.

Side-effecting tool calls use a Run-scoped operation key derived from tool name and canonical arguments. Retrying the
same arguments in one Run therefore returns the recorded result instead of repeating the side effect; this also means an
intentional second identical call is treated as the same operation. A pending operation is never replayed automatically.
After 30 minutes without an authoritative outcome it becomes terminal `uncertain`, which is deliberately longer than
the tool transport timeout. The user must verify the remote system before issuing a new explicit operation.

## Built-in tool boundary

Takos has 21 static, Takos-owned tools:

- agent/artifact/discovery: `spawn_agent`, `wait_agent`, `create_artifact`, `store_search`, `toolbox`;
- web: `web_fetch`;
- chat attachment: `chat_attachment_read` (only a `file_id` actually attached under the current thread's
  `/chat-attachments` path; it is not a general storage tool);
- memory: `remember`, `recall`, `set_reminder`; derived Run search: `info_unit_search`;
- MCP registration: `mcp_add_server`, `mcp_list_servers`, `mcp_update_server`, `mcp_remove_server`;
- custom skills: `skill_list`, `skill_get`, `skill_create`, `skill_update`, `skill_toggle`, `skill_delete`.

Computer, filesystem, object-storage, and Git operations are not static Takos tools. The agent finds those capabilities
through `toolbox` after the corresponding Capsule or external MCP server is available.

`web_fetch` opens and extracts a known URL; it does not search the Web. Takos has no built-in `web_search`. Web search is
available only when a registered external MCP server publishes a suitable search tool. If none is registered, the agent
must report that search is unavailable and may still use `web_fetch` for URLs supplied by the user or returned by another
source.

## API authority

Takos API bearer authority is split by operation. `mcp:invoke` permits connection discovery, server/tool reads, and the
current user's one-time confirmation decisions. `mcp:manage` permits connection, Registry source, OAuth-start, tool-policy,
and portable import/export mutations. Neither scope implies the other. Browser sessions retain their normal Workspace
role checks; these scopes constrain Takosumi Accounts bearer credentials rather than bypassing Workspace membership.

## Boundary

Takos owns external MCP discovery sources, connection OAuth and token persistence, tool display and consent,
pre-invocation exposure checks, and invocation UX. Takosumi owns the Capsule Source / Run / StateVersion / Output ledger,
OpenTofu execution and dependency pinning, Interface resolution, InterfaceBinding authorization, and deploy-time
provider credential, policy, and audit evidence. Provider credentials remain in ProviderConnection / CredentialRecipe /
ProviderBinding / vault / runner phase boundaries. Runtime credentials require an explicitly supported Binding delivery
mechanism and never come from public OpenTofu Output values.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [OpenTofu Outputs and runtime Interfaces](/deploy/runtime-interfaces)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
- [MCP Registry overview](https://modelcontextprotocol.io/registry/about)
- [MCP Registry schema](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)
- [Experimental MCP Server Card extension](https://github.com/modelcontextprotocol/experimental-ext-server-card)
- [Experimental Server Card discovery](https://github.com/modelcontextprotocol/experimental-ext-server-card/blob/main/docs/discovery.md)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [OAuth 2.0 Security Best Current Practice (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700)
- [OAuth 2.0 Authorization Server Issuer Identification (RFC 9207)](https://www.rfc-editor.org/rfc/rfc9207)
