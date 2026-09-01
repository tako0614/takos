# Takoform deployment adapter

This OpenTofu module maps Takos's product-owned logical resources from
deploy/product-resources.json to the published Takoform provider. It is an
adapter, not a second Takos architecture and not a Takosumi-only execution
path.

The Worker archive and relational schema bundle are pinned to immutable public
Takos bytes from the same `worker_release_tag`. The default pins belong to the
published `v0.12.0` release; regenerating the tracked source bundle does not
silently move those release defaults. When selecting another Worker release,
set `database_schema_url` and `database_schema_sha256` to that release's exact
bundle as one change. The module rejects a schema URL that does not contain the
selected release tag. The only container is the bounded `takos-agent` execution service;
shell, desktop, browser, Git Actions, and general-purpose compute are not hidden
Takos infrastructure. Those capabilities come from separately installed apps
such as `takos-computer` or from an explicit external runtime adapter.

The agent image is an ordinary digest-pinned OCI input because a portable
module must not embed a Cloudflare Container Registry address. A release or
self-hoster supplies an image the destination can fetch through the normal
OpenTofu variable path.

The sibling `../cloudflare` module is the direct Cloudflare adapter. Both
modules expose `launch_url`; Takosumi installs either as an ordinary repository
module and obtains the app launcher from that output.
