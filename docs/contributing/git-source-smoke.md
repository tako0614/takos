# Git Source Proof

> このページでわかること: Git URL install / source resolution の current proof。

Git URL install と `.takosumi/` project convention は `takosumi-git` が正本です。

```sh
cd ../takosumi-git
deno task check
deno task test
```

Takos product 側の distribution / bundled app install path は product gate で確認します。

```sh
cd takos
deno task validate:distributions
deno task distribution:smoke
```

Public managed offering の Git URL install rehearsal は `takos-private`
managed-offering evidence bundle の staged rehearsal step として記録します。
