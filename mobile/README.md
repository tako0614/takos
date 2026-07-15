# Takos Mobile

Tauri-first mobile client shell for Takos.

The shell is a client for an existing Takos host URL. It can also hand users to
Takosumi Host Center to create a host, but host creation and lifecycle management
remain Takosumi responsibilities.

Mobile-specific UI is intentionally selective. Mature host screens stay on the
connected Takos host and are opened through route handoff / in-app browser;
native UI is reserved for compact previews, quick capture/actions, device-backed
flows, and deep-link handling. Remote push remains feature-off until the build
supplies a gateway URL; native/store readiness additionally requires provider
configuration and physical-device evidence.

Current surface:

- URL / QR payload entry
- mobile route deep links such as `takos://open?path=/chat`, including
  pending route open after sign-in when the payload includes `host_url`
- recent Takos host list for reconnecting without retyping URLs, with shared
  remove / clear controls
- Host Center return payload handling
- host discovery through the Takosumi Mobile Kit foundation
- OIDC PKCE sign-in, session restore, and sign-out through the foundation
  controller
- connected host URL copy through the shared clipboard text seam
- signed-in home summary for workspace/app/unread counts and recent
  chat-message preview with tapped host-route handoff
- signed-in notification inbox backed by `/api/notifications`, with keyset
  Load more, tapped host-route handoff, host notification handoff, and
  per-notification / bulk mark-read actions
- signed-in notification settings backed by `/api/notifications/preferences`
  and `/settings`, with mute controls and in-app / email / push channel toggles
- signed-in quick chat composer that can continue a recent host-backed thread
  or create a new one, stores the user message, starts a run, and then offers a
  hosted chat handoff with Bearer fetch SSE run streaming, automatic polling
  fallback, assistant answer preview, compact transcript, run status refresh,
  and cancel controls
- signed-in recent chat cards with a compact conversation preview and inline
  thread expansion, Load older, hosted handoff, and inline reply composer for
  continuing a thread without leaving the mobile client
- signed-in active chat list so the quick composer and hosted handoff are not
  limited to the top three preview threads
- signed-in full-thread native transcript browser for any active chat, with
  latest/older message windows, message count, host handoff, and inline reply
  composer
- signed-in agent task preview backed by `/api/spaces/:spaceId/agent-tasks`,
  with task status, priority, latest-run status, host chat handoff, and inline
  Start / Done / Block status controls
- signed-in quick agent task creation backed by
  `POST /api/spaces/:spaceId/agent-tasks`, with priority controls, automatic
  task thread creation, and host chat handoff after create
- signed-in memory preview backed by `/api/spaces/:spaceId/memories`, with
  memory type/category/importance, host memory handoff, and inline delete
  controls
- signed-in quick memory capture backed by `POST /api/spaces/:spaceId/memories`,
  with type/category controls and host memory handoff after save
- signed-in installed-app list backed by `/api/apps`, with typed
  host-route/external/unavailable launch targets, launcher/details handoff, and
  safe URL rejection
- signed-in Git URL app install backed by
  `/api/spaces/:spaceId/app-installations/git-url/plan` + `/apply`, with an
  explicit mobile plan review before install
- signed-in app installation lifecycle preview backed by
  `/api/spaces/:spaceId/app-installations`, with host/external launch,
  plan/apply update, remove, and installation-detail handoff when the host
  returns lifecycle metadata
- signed-in shortcuts that open the connected host's workspace, chat, apps, and
  notifications through the native browser handoff instead of rebuilding those
  full host screens in native UI
- Takosumi Mobile Kit shell UI with Takos-specific metrics, shortcuts, and
  palette
- Takosumi Mobile Kit app bootstrap; `src/main.tsx` is
  mostly typed product config
- typed Tauri default product bridge factory from Takosumi Mobile Kit
  for deep links, opener, persistent store, Stronghold, local notifications,
  QR scanning, clipboard text writes, optional remote-push injection, and
  opener-backed call fallback
- Stronghold-backed secure token/session storage with a product-owned Android
  Keystore / iOS Keychain seed. Legacy product-scoped Tauri Store seeds are
  migration-only and are deleted after native read-back verifies the same value
- Tauri v2 deep-link, opener, clipboard-manager, path, store, Stronghold,
  local notification, and QR scanner plugin wiring
- Tauri v2 biometric plugin wiring exposed through a typed optional native
  authentication seam
- Tauri OS Information plugin wiring so mobile-only native capabilities are
  advertised only on iOS / Android runtimes
- biometric-gated restore for saved sessions on supported mobile runtimes
- typed optional seams for remote push token registration and call intents,
  with shared controller support for opt-in push host registration, token
  refresh re-registration, and tapped-notification host route handoff
- product-owned APNs/FCM native push plugin wiring: iOS performs session-bound
  APNs registration and Android uses the current FCM Firebase Installation ID
  (FID) lifecycle. Both providers unregister on sign-out and register again on
  the next signed-in push request
- remote push host delivery uses event-id-only envelopes, a durable Queue/DLQ
  when bound, bounded `Retry-After`, SSRF-gated egress, rejected-key cleanup,
  transient retries, and stale-registration retention. Committed Agent
  completion/failure owns `run.completed` / `run.failed`; only those two
  categories default push on without overwriting an existing preference
- opener-backed call intent fallback for future room/call URLs; true
  incoming-call UI remains product-native plugin work
- product-local Notification Pusher adapter backed by
  `POST /api/notifications/pushers`. It registers `jp.takos.mobile`, the native
  APNs token or FCM FID as the opaque `pushkey`, provider/environment metadata,
  and the build-time `VITE_TAKOS_NOTIFICATION_PUSHER_GATEWAY_URL`. Missing
  gateway configuration keeps remote push explicitly feature-off. The host
  operator must allow the public gateway hostname through
  `TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS`
- local Worker development may explicitly set
  `TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK=true` for an HTTP loopback
  gateway. Credentials, fragments, remote HTTP, and private-network targets
  remain rejected
- product-local mobile tests for home summary, chat message windows, quick
  chat, notification inbox pagination, notification settings, and push
  registration payloads; shared mobile-kit tests cover push token refresh and
  notification events
- product-owned `src-tauri/app-icon.svg` plus generated Tauri desktop,
  Android, and iOS icon assets
- Tauri Android/iOS command scripts, Vite `TAURI_DEV_HOST` mobile dev host
  handling, and a mobile doctor for native readiness checks

Useful commands:

```sh
bun run mobile:check
bun run mobile:doctor
bun run mobile:native-release-check
bun run mobile:release-evidence-check
bun run mobile:release-check
bun run mobile:release-status
bun run mobile:repo-release-check
cd mobile && bun run test
cd mobile && bun run tauri:android:init
cd mobile && bun run tauri:native-push:apply
cd mobile && bun run tauri:native-push:verify
cd mobile && bun run tauri:android:dev
cd mobile && bun run tauri:ios:init
cd mobile && bun run tauri:ios:dev
cd mobile && bun run tauri:native-push:apply:release
cd mobile && bun run tauri:native-push:verify:release
```

Remaining release work:

- keep native coverage focused on mobile-critical quick actions and route
  handoff, not full parity with every host list/settings/detail screen
- Android/iOS physical-device verification for the product-owned keystore,
  Stronghold seed migration, cold restart, biometric cancellation/changes, and
  app upgrades
- generated Android/iOS projects with iOS Push Notifications entitlement,
  Android `google-services.json`, and Firebase Gradle configuration. Product
  init scripts apply non-secret wiring; provider configuration remains
  operator-owned
- an operator-deployed APNs/FCM pusher gateway plus physical-device evidence for
  permission, initial/refreshed registration, sign-out unregistration,
  rejected-key cleanup, and foreground/background/terminated/tap delivery
- product-native incoming-call adapter through the typed `callIntent` seam when
  Takos has a concrete call surface
- store signing, screenshots, and App Store / Play Store packaging

`mobile:doctor` validates the checked-in Tauri config, capabilities, plugin
permissions, Vite mobile dev host handling, and local native toolchain
readiness. Java, Android SDK, NDK, Android Rust targets, macOS/Xcode iOS
readiness, and iOS Rust targets are reported as warnings unless the script is
run with `--strict-native-env`. `mobile:native-release-check` runs that strict
native doctor plus production native-push wiring verification, so it is
expected to fail until generated Android/iOS projects, production
`aps-environment`, SDKs, and Rust mobile targets are in place.
`mobile:release-evidence-check` validates
`mobile/release/mobile-release-evidence.json` (or
`MOBILE_RELEASE_EVIDENCE_FILE`) for store signing, uploaded artifact,
screenshot, native-security scenarios, remote-push backend and physical-device
evidence, and mobile OIDC evidence. `mobile:release-check` runs both checks and
requires status parity.
`mobile:release-status` prints a short blocker summary without failing, so it
is the quickest way to see what remains before the strict release gate can pass.
`mobile:repo-release-check` fails only repository-actionable blockers. It also
requires the hosted native-preflight workflow to pin the committed, public
Takosumi mobile-kit revision that contains every helper used by the workflow;
successful hosted checkout is the final public-reachability proof.
