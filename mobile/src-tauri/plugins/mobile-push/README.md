# Takos Mobile Push Plugin

This private, product-owned Tauri plugin is the native APNs/FCM client bridge
for Takos Mobile. It exposes only notification permission, the opaque APNs
device token or FCM Firebase Installation ID (FID) with `apns` or `fcm`
provider metadata, provider unregistration, and
received/tapped/registration-refresh events. It does not know a push gateway
URL and does not send identifiers to a host.

Android uses the FCM 25.1+ FID APIs (`register`, `unregister`, and
`onRegistered`) with auto-init disabled. It registers only for a signed-in push
request, and requires the generated app to apply the Google Services Gradle
plugin and provide its operator-owned `google-services.json`. The public bridge
retains the generic `token` field name for cross-provider compatibility, but its
FCM value is an opaque FID that the gateway sends as `message.fid`.

iOS requests display authorization separately from APNs registration,
registers when a signed-in push request needs a token, unregisters on sign-out,
and keeps the current registration's variable-length device token in memory
only. Its reported `sandbox` or `production` environment is derived from the
signed `aps-environment` entitlement; token requests fail closed when that
entitlement is missing or invalid.

Native events are queued only until the first matching JavaScript listener is
activated. Tauri's own listener registry remains authoritative after that
barrier; events received while signed out are dropped instead of being retained
for a later account or host session.

Provider unregistration is a defense-in-depth cleanup after the host pusher
DELETE. FCM `unregister()` makes the FID inactive until a later explicit
`register()`; iOS `unregisterForRemoteNotifications()` stops APNs delivery until
a later `registerForRemoteNotifications()` request.

Generated native projects, Firebase configuration, Apple entitlements,
signing, physical-device checks, and delivery credentials remain release
environment responsibilities. Development wiring uses
`aps-environment = development`; release verification requires
`aps-environment = production`.
