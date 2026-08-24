# OpenTofu deployment adapters

Takos owns one provider-neutral resource graph in
[`../product-resources.json`](../product-resources.json).

- `cloudflare` is the current supported adapter and maps the complete graph to
  resources in a user-connected Cloudflare account.
- `takoform` is retained source history for the former Provider 1.x projection.
  It is not selectable from the current Repository manifest because current
  Forms do not represent Takos's complete topology.

The adapter is not the Takos architecture or a privileged control path.
Takosumi runs it as an ordinary OpenTofu module, and direct OpenTofu users can
run it without Takosumi. Provider credentials are supplied through normal
provider configuration and never stored in this repository.
