# Retired Takoform Provider 1.x projection

This source tree preserves the former Provider 1.x projection for release
history and migration analysis. It is not listed in the current Repository
manifest or install options: current Forms do not represent Takos's complete
product-owned graph, including StatefulEntity and its native runtime bindings.

The Worker archive and relational schema bundle are pinned to immutable public
Takos bytes. The only container is the bounded `takos-agent` execution service;
shell, desktop, browser, Git Actions, and general-purpose compute are not hidden
Takos infrastructure. Those capabilities come from separately installed apps
such as `takos-computer` or from an explicit external runtime adapter.

The agent image is an ordinary digest-pinned OCI input because a portable
module must not embed a Cloudflare Container Registry address. A release or
self-hoster supplies an image the destination can fetch through the normal
OpenTofu variable path.

The sibling `../cloudflare` module is the current supported adapter. It exposes
`launch_url`; Takosumi installs it as an ordinary repository module and obtains
the app launcher from that output. Do not use this retired tree for a new
install or relabel it as Provider 3 compatibility.
