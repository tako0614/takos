# Takoform deployment adapter

This OpenTofu module maps Takos's product-owned logical resources from
deploy/product-resources.json to the published Takoform provider. It is an
adapter, not a second Takos architecture and not a Takosumi-only execution
path.

The Worker archive is pinned to the public Takos release. Container images are
ordinary digest-pinned OCI inputs because a portable module must not embed a
Cloudflare Container Registry address. A host or self-hoster supplies images
it can fetch through the normal OpenTofu variable path.

The existing deploy/opentofu module remains the direct Cloudflare adapter.
Both modules expose launch_url; Takosumi installs either as an ordinary
repository module and obtains the app launcher from that output.
