# takos-office

`takos-office` is an Office Capsule app users can explicitly install into a Takos Workspace. It combines Docs, Slide, and
Sheet surfaces in one worker and publishes one MCP endpoint for agent use.

## Runtime contract

Takos Office is a normal removable Capsule app. It publishes UI surfaces, file handlers, and a `protocol.mcp.server`
publication. It consumes the `storage.object` publication from an independently installed `takos-storage` Capsule.

The consume requests `files:read` / `files:write`. Takosumi's bind-time grant broker injects the endpoint as
`OBJECT_STORAGE_API_URL`, a prefix-scoped bearer as `OBJECT_STORAGE_ACCESS_TOKEN`, and the assigned object prefix as
`OBJECT_STORAGE_KEY_PREFIX`. The credential comes from protected `takos-storage` signing material and never appears in
a public OpenTofu Output.

## Surfaces

- `/docs` for `.takosdoc`
- `/slide` for `.takosslide`
- `/sheet` for `.takossheet`
- `/mcp` for the unified Office MCP server

Office stores document, slide, and sheet data through the same `storage.object` publication.
They are not separate current apps.

## References

- [Installable Apps](/platform/featured-apps)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
