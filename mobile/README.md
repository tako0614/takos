# Takos Mobile

Tauri-first mobile client shell for Takos.

The shell is a client for an existing Takos host URL. It can also hand users to
Takosumi Host Center to create a host, but host creation and lifecycle management
remain Takosumi responsibilities.

Mobile-specific UI is intentionally selective. Mature host screens stay on the
connected Takos host and are opened through route handoff / in-app browser;
native UI is reserved for compact previews, quick capture/actions, device-backed
flows, and foreground push/deep-link handling.

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
  QR scanning, clipboard text writes, mobile-push normalization, and
  opener-backed call fallback
- Stronghold-backed secure token/session storage with a mobile keystore-backed
  Stronghold password seed and product-scoped Tauri Store fallback for
  desktop/dev and migration
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
- product-local `tauri-plugin-mobile-push-api` / `tauri-plugin-mobile-push`
  wiring for APNs / FCM remote push token registration and event listeners
- opener-backed call intent fallback for future room/call URLs; true
  incoming-call UI remains product-native plugin work
- product-local push host registration helper backed by
  `POST /api/mobile/push-registrations`
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
cd mobile && bun run test
cd mobile && bun run tauri:android:init
cd mobile && bun run tauri:native-push:apply
cd mobile && bun run tauri:native-push:verify
cd mobile && bun run tauri:android:dev
cd mobile && bun run tauri:ios:init
cd mobile && bun run tauri:native-push:apply
cd mobile && bun run tauri:native-push:verify
cd mobile && bun run tauri:ios:dev
```

Remaining release work:

- keep native coverage focused on mobile-critical quick actions and route
  handoff, not full parity with every host list/settings/detail screen
- device testing and production hardening for the alpha mobile keystore plugin
  path that protects the Stronghold password seed on Android/iOS
- device-specific push setup after native project generation:
  `tauri:native-push:apply` patches iOS `aps-environment` entitlements and
  Android Firebase / FCM Gradle + manifest wiring, and
  `tauri:native-push:verify` runs the same checks in strict dry-run mode and
  fails if native generated files still need patching; store/team-specific APNs
  and Firebase project configuration still remains production work
- product-native incoming-call adapter through the typed `callIntent` seam when
  Takos has a concrete call surface
- store signing, screenshots, and App Store / Play Store packaging

`mobile:doctor` validates the checked-in Tauri config, capabilities, plugin
permissions, Vite mobile dev host handling, and local native toolchain
readiness. Java, Android SDK, NDK, Android Rust targets, macOS/Xcode iOS
readiness, and iOS Rust targets are reported as warnings unless the script is
run with `--strict-native-env`. `mobile:native-release-check` runs that strict
native doctor plus `tauri:native-push:verify`, so it is expected to fail until
the generated Android/iOS projects, SDKs, Rust mobile targets, and
product-owned APNs/Firebase push files are in place.
`mobile:release-evidence-check` validates
`mobile/release/mobile-release-evidence.json` (or
`MOBILE_RELEASE_EVIDENCE_FILE`) for store signing, uploaded artifact,
screenshot, and device smoke evidence. `mobile:release-check` runs both checks
and reports both failure classes in one run.
`mobile:release-status` prints a short blocker summary without failing, so it
is the quickest way to see what remains before the strict release gate can pass.
