# takos-slide

Google Slides alternative のプレゼンテーションエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- プレゼンテーションの作成・編集
- スライド操作 (追加 / 削除 / 並び替え)
- テキスト・図形・画像の配置
- source tree の standalone MCP server でスライド操作 tools を提供
- UiSurface でプレゼンテーション UI を提供
- group に所属しなくても動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-slide.app.example.com` or `slides.mycompany.com`

single worker (web) 構成。

```text
{hostname}
  /     → built frontend / static asset surface (deployment mount)
```

## Publications

`path: /` は built frontend / static asset surface の mount point を表し、server
entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: slide-ui
    type: UiSurface
    publisher: web
    path: /
    title: Slide
```

`UiSurface` は custom route publication type であり、deploy manifest の
`publish` entry で catalog を管理します。source tree には standalone MCP server
もあるが、現在の default deploy workflow artifact には含めない。

## Capability grants

`takos-api` は route / interface publication ではなく、kernel API への access を
受け取る capability grant です。

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
        - files:write
```

default app manifest / workflow は UI の built frontend / static asset surface
だけを publish する。source tree の standalone MCP server は同じ app source に
含まれるが、現在の default deploy surface では MCP / health route
として公開しない。

## Scopes

| scope       | 用途                                   |
| ----------- | -------------------------------------- |
| files:read  | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み   |
