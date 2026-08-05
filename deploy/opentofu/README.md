# OpenTofu deployment adapters

Takos owns one provider-neutral resource graph in
[`../product-resources.json`](../product-resources.json). The directories here
are peer adapters for that graph:

- `takoform` maps it to portable service forms. This is the default Takosumi
  install path; the selected Takoform host chooses the concrete cloud.
- `cloudflare` maps it directly to resources in a user-connected Cloudflare
  account.

Neither adapter is the Takos architecture or a privileged control path.
Takosumi runs both as ordinary OpenTofu modules, and direct OpenTofu users can
run either without Takosumi. Provider credentials are supplied through the
normal provider configuration and never stored in this repository.
