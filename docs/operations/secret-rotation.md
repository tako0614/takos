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
  values, API keys, or generated key material.
- OIDC client secret は Takos が自前管理しません。Installable App Model では
  **`takosumi.account.auth@v1` service identifier で resolve される Takosumi
  Accounts** が per-AppInstallation で OIDC client secret を発行・rotation
  します。 Takos は AppBinding (`identity.oidc@v1`) 経由で `OIDC_CLIENT_SECRET`
  を runtime に受け取るだけで、OAuth client registry / consent / token endpoint
  を持ちません (see [/architecture/takosumi-accounts] /
  [/reference/binding-catalog])。
- Use `takos/docs/hosting/secrets.md` for public secret ownership rules.
- Keep public examples as placeholders or fixture-only values.
- Record live rotation evidence only in the private run log.
