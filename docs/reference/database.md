# データベース所有権

> このページでわかること: どのプロダクトがどのデータを所有しているか。

## Ownership

| data area | owner | notes |
| --- | --- | --- |
| account identity | Takosumi Accounts | user, organization, OIDC subject, account profile |
| billing | Takosumi Accounts | BillingPort / Stripe customer mapping |
| AppInstallation ledger | Takosumi Accounts | source commit, app manifest digest, compiled manifest digest, grants, bindings |
| deployment records | Takosumi kernel | Deployment, GroupHead, provider observations, operation journal |
| Git repositories | Takos Git hosting | repository metadata, refs, object storage references |
| agent runs | Takos agent / Takos app | product agent workflow state |
| app-local profile | Takos app | Takos UI profile and product-local preferences |
| bundled app data | each bundled app | docs / slide / excel / computer / yurucommu own their data |

## Rules

- Takos app does not own account, billing, or AppInstallation ledger tables.
- Takosumi kernel does not own product user profile or billing tables.
- `takos-private/` connects through published packages, images, APIs, and manifests.
- Cross-service wire shapes come from the owning service contract package.

## References

- [API Reference](/reference/api)
- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
- [Takosumi kernel storage schema](https://github.com/tako0614/takosumi/blob/master/docs/reference/storage-schema.md)
- [AppInstallation ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
