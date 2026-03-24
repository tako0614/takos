# CLI / Auth model

Takos CLI は task-oriented です。  
HTTP verb をそのまま露出するのではなく、domain ごとの task を前面に出します。

## 認証

基本的な auth flow:

```bash
takos login
takos whoami
takos logout
```

endpoint は切り替え可能です。

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint use https://api.takos.dev
takos endpoint show
```

## domain + task verbs

Takos CLI では `api` 直叩きではなく、domain + task verbs を使います。

例:

```bash
takos workspace list
takos repo create --body '{"name":"my-repo"}'
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos run follow RUN_ID --transport ws
```

主な task verb:

- `list`
- `view`
- `create`
- `replace`
- `update`
- `remove`
- `probe`
- `describe`
- `watch`
- `follow`

## removed legacy surface

Takos CLI は次を intentionally 露出しません。

- `takos api ...`
- 直接的な HTTP verb style subcommands
- 古い legacy command group

## deploy CLI

`takos deploy` は repo-local `.takos/app.yml` を前提に deploy します。

- source of truth: `.takos/app.yml`
- source ref: `--repo`, `--ref`, `--ref-type`
- local validate: `takos deploy validate`
- status / rollback: `takos deploy status`, `takos deploy rollback`

## container mode

Takos session container 内では、次の env があれば auth は自動解決されます。

- `TAKOS_SESSION_ID`
- `TAKOS_WORKSPACE_ID`
- `TAKOS_API_URL`
