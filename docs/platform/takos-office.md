# takos-office

`takos-office` is an Office Capsule app users can explicitly install into a Takos Workspace. It combines Docs, Slide, and
Sheet surfaces in one worker and publishes one MCP endpoint for agent use.

## Runtime contract

Takos Office is a normal removable Capsule app. It publishes UI surfaces, file handlers, and a `protocol.mcp.server`
publication. It consumes Takos Workspace Storage through `takos.storage.workspace`, whose capability is
`storage.filesystem`.

The storage URL is projected into the worker as `TAKOS_STORAGE_API_URL`. Bearer authority is not an OpenTofu output and
is delivered by the workload runtime through `TAKOS_STORAGE_ACCESS_TOKEN` or the existing `TAKOS_ACCESS_TOKEN` binding.

## Surfaces

- `/docs` for `.takosdoc`
- `/slide` for `.takosslide`
- `/sheet` for `.takossheet`
- `/mcp` for the unified Office MCP server

The historical storage folders `/takos-docs/`, `/takos-slide/`, and `/takos-excel/` remain data compatibility paths.
They are not separate current apps.

## References

- [Installable Apps](/platform/featured-apps)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
