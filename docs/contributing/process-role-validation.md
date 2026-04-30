# Process role validation

`deno run --allow-read scripts/validate-process-roles.ts` checks the local
Compose file and Helm templates without adding YAML parser dependencies. It
accepts only the documented PaaS process roles in `takos.io/process-role` labels
and `TAKOS_PAAS_PROCESS_ROLE` env values, and fails if any documented role is
missing from the discovered label/env values.
