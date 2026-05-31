# Git Source Proof

> このページでわかること: Git URL install / source resolution の current proof。

Git URL install と `.takosumi.yml` AppSpec convention は `takosumi` が正本です。

```sh
cd ../takosumi
bun run check
bun run test
```

Takos product 側の distribution / bundled app install path は product gate
で確認します。

```sh
cd takos
bun run validate:distributions
bun run distribution:smoke
```

Public managed offering の Git URL install rehearsal は `takos-private`
managed-offering evidence bundle の staged rehearsal step として記録します。
