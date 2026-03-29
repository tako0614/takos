# takos-cli

Task-oriented unified CLI for Takos.

## Installation

```bash
npm install -g takos-cli
```

## Authentication

```bash
takos login
takos whoami
takos logout
```

## Endpoint Switching

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint use https://api.takos.dev
takos endpoint show
```

`takos login` without `--api-url` uses the endpoint saved by `takos endpoint use ...`.

## Task-Oriented Commands

`takos` no longer exposes `api` direct-call commands. Use domain + task verbs.

```bash
# Workspace tasks
takos workspace list
takos workspace create --body '{"name":"my-workspace"}'
takos workspace view /WORKSPACE_ID/members

# Repository tasks
takos repo list
takos repo create --body '{"name":"my-repo"}'
takos repo update /REPO_ID --body '{"description":"updated"}'

# Thread / run tasks
takos thread create /THREAD_ID/messages --body '{"content":"hello"}'
takos run list /THREAD_ID

# App deploy
takos deploy-group --space SPACE_ID --env-file .env --allow-no-domain
takos deploy validate
takos apply --spec deploy.json
```

Common task verbs:

- `list`
- `view`
- `create`
- `replace`
- `update`
- `remove`
- `probe` (HEAD)
- `describe` (OPTIONS)

## Streaming (WebSocket + SSE)

```bash
# Generic stream watcher on stream-capable domains
takos run watch /RUN_ID/ws --transport ws
takos run watch /RUN_ID/events --transport sse

# Dedicated run follow task
takos run follow RUN_ID --transport ws
takos run follow RUN_ID --transport sse --last-event-id 0

# GitHub Actions-compatible run stream (now under repo)
takos repo follow REPO_ID RUN_ID --transport ws
```

## Domains

Available domains include:

- `me`, `setup`, `workspace` (`ws`), `project`, `thread`, `run`, `artifact`, `task`
- `repo`, `worker`, `app`, `resource`, `git`
- `capability` (`cap`), `context` (`ctx`), `shortcut`, `notification`
- `public-share`, `auth`, `discover`

Consolidated domains (old names show a redirect with migration guidance):

- `pr`, `actions` merged into `repo`
- `memory`, `reminder` merged into `context`
- `skill`, `tool` merged into `capability`
- `oauth` merged into `auth`
- `search`, `install` merged into `discover`

## Request Options

For request tasks (`list/view/create/replace/update/remove/probe/describe`):

- `--query key=value` (repeatable)
- `--header key=value` (repeatable)
- `--body <json>` / `--body-file <path>`
- `--raw-body <text>` / `--raw-body-file <path>`
- `--form key=value` (repeatable)
- `--form-file key=path` (repeatable)
- `--workspace <id>`
- `--output <path>`
- `--json`

For stream tasks (`watch/follow`):

- `--transport ws|sse`
- `--query key=value` (repeatable)
- `--header key=value` (repeatable)
- `--workspace <id>`
- `--json`
- `--last-event-id <id>` (SSE)
- `--send <message>` (WebSocket, repeatable)

## Removed Legacy Commands

The following are removed intentionally:

- `takos api ...`
- Domain HTTP-verb style subcommands (`get/post/put/patch/delete/head/options/call/sse/ws`)
- Old legacy command groups (`takos workers`, `takos apps`, `takos resources`)

## App Deploy Contract

`takos deploy` is removed in the current implementation.

- Source of truth: `.takos/app.yml`
- Active flows: `takos deploy-group` for group deploys, `takos apply` for prepared specs
- Validation: `takos deploy validate` validates local manifest/workflow references
- Removed surface: `/api/spaces/:spaceId/app-deployments` remains unavailable and returns `410 Gone`

## Container Mode

When running inside a Takos session container, authentication is automatic via:

- `TAKOS_SESSION_ID`
- `TAKOS_WORKSPACE_ID`
- `TAKOS_API_URL`

## Configuration

Credentials are stored in `~/.takos/config.json`.

## License

GNU AGPL v3
