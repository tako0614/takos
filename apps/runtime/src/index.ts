async function main(): Promise<void> {
  // 開発環境では ts-node で直接実行されるため、TS ワークスペースパッケージを読み込めます。
  // 本番環境では `node dist/index.js` を実行するため、ビルド済みの JS 成果物を読み込む必要があります。
  const pkg = "takos-runtime-service";
  const mod: typeof import("takos-runtime-service") =
    import.meta.url.endsWith(".ts") ? await import(pkg) : await import(
      new URL(
        "../../../packages/runtime-service/dist/index.js",
        import.meta.url,
      ).href
    );

  mod.startRuntimeService();
}

void main();
