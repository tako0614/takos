# Secret Rotation

Takos public source does not store production or staging secret values. Public
docs define the ownership boundary only:

- `takos/` documents public contracts, non-secret hosting expectations, and
  release gates.
- `takos-private/` owns operator runbooks, staging / production secret
  inventory, rotation evidence, and private rollback notes.
- `takosumi` / `takosumi-git` own generic PaaS and workflow behavior; Takos does
  not add CLI project-layout secret UX here.

For Takos-operated environments, use the private runbook at
`takos-private/docs/operations/secret-rotation.md`. That runbook covers platform
keypairs, Worker secrets, provider credentials, and selfhosted env files without
publishing secret material.

Public guidance:

- Do not commit provider credentials, tfvars with live values, Worker secret
  values, OAuth client secrets, API keys, or generated key material.
- Use `takos/docs/hosting/secrets.md` for public secret ownership rules.
- Keep public examples as placeholders or fixture-only values.
- Record live rotation evidence only in the private run log.
