# Takos mobile keystore plugin

This product-owned Tauri plugin stores the Stronghold password seed in Android
Keystore-backed AES-GCM storage or the iOS Keychain. It intentionally keeps the
existing `plugin:keystore` command surface while requiring an explicit `service`
and `user` for every operation.

The native item is device-local and non-synchronizing. Biometric session unlock
is handled separately by the Takos mobile client so reading the Stronghold seed
does not create a second native authentication prompt during startup.

The plugin is part of the Takos mobile source and is not published as a generic
standalone package.
