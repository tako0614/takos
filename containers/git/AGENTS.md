# AGENTS.md — takos-git (Takos Git hosting service)

`takos-git` は Takos の **Git hosting service** で、 Git Smart HTTP / repository
metadata / refs / object storage / source resolution / repository API contracts
を所有する。 ecosystem sibling の `takosumi` (Git URL / prepared source provenance
と OpenTofu-native deploy control の canonical implementation) とは別物。

## 責務

### 持つ

- Git Smart HTTP hosting (clone / push / fetch)
- repository metadata / refs / object storage
- source snapshot resolution (Takosumi kernel への source provenance)
- repository API contracts (signed internal RPC 受け入れ)
- Takos Git authorization (signed internal actor context の verify)

### 持たない

- account / auth / profile / billing / OAuth behavior (`../../src/worker/` の責務)
- tenant runtime / deploy / container orchestration (`../../takosumi/` の責務)
- browser / API-client auth verify そのもの (`takos-worker` が verify した後 signed
  internal actor context として受ける)

## 隣接 product との contract

- **Upstream**: 直接の upstream なし (Takos product 内の self-contained service)
- **Downstream**: Takos product (`../../src/worker/` が browser / API-client auth を
  verify した後の signed internal RPC で接続)、 Takosumi kernel (control plane
  が source snapshot 取得のため呼ぶ)
- **Sibling**: `../agent/` (independent service wrapper source)

## Substitutability

代替実装可: bare repository storage を持つ Git HTTP server なら replace 可能。
ただし signed internal RPC protocol は Takos contract に従う必要がある。

## Workflow

```bash
cd takos/containers/git
bun run check
bun run lint
bun run fmt
bun test
bun run dev
bun run smoke:live
```

## 関連 docs

- [`README.md`](README.md) — service overview と quickstart
- [`docs/`](docs/) — production storage / signed RPC / API spec (存在すれば)
