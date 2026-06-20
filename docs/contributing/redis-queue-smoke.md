# Queue Proof

> このページでわかること: queue / background worker surface の current proof。

Takos product queue behavior is covered by the app control tests and local stack
smoke. Run:

```sh
cd takos
bun run test
```

For the composed product stack, use:

```sh
cd takos
bun run local:config
bun run local:smoke
```

Cloudflare Queue / provider queue health is live operator evidence and belongs
in the hosted Takosumi or distribution target evidence bundle.
