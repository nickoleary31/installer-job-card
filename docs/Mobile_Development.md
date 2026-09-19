# Mobile Development (Capacitor)

Status: **Phase 1C — online functional mobile client.** The native shell (`android/`, `ios/`)
boots from a locally packaged static export (`mobile-web/`, built by Next.js `output: "export"`),
not from a remote URL — see `capacitor.config.ts`'s comments and the Phase 1A/1B/1C history in git
log for the full rationale. `mobile-web/` reuses the real Installer Sheetz UI/business logic from
`lib/` and `components/` via imports; it does not duplicate it.

## Prerequisites

To build the Android project you need, on your `PATH` (or pointed at via the env vars below):

- **JDK 21** — the Android Gradle Plugin used here requires Java 21 source compatibility. JDK 17
  is not sufficient and fails the build with `invalid source release: 21`.
- **Android SDK** with:
  - **Platform 36** (`platforms;android-36`) — matches `compileSdkVersion`/`targetSdkVersion` in
    `android/variables.gradle`.
  - **Build-Tools 36.0.0** (`build-tools;36.0.0`)
  - Platform-tools (`adb`, etc.)

Install these however you normally manage SDKs on your machine (Android Studio's SDK Manager, the
standalone `sdkmanager` command-line tools, Homebrew, etc.) — there's no requirement on *where*
they live. Point Gradle at them via the standard mechanisms:

- `JAVA_HOME` environment variable → your JDK 21 install
- `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) environment variable → your Android SDK install
- `android/local.properties` → `sdk.dir=<path to your Android SDK>` (gitignored — machine-specific,
  never commit this file). **Use forward slashes even on Windows** (`C:/Android/Sdk`, not
  `C:\Android\Sdk`) — a literal backslash in a Java `.properties` file is an escape character (e.g.
  `\t` becomes a tab), which silently corrupts the path and produces a confusing Gradle failure.

Once `mobile-web` is built (see below) and those are in place:

```bash
cd android
./gradlew assembleDebug
```

produces a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`.

iOS builds require Xcode on macOS — nothing here has been build-verified on iOS yet.

## Building and packaging mobile-web (the app the native shell loads)

`mobile-web/` is a second, minimal Next.js project (own `package.json`, own `next.config.ts` with
`output: "export"`) that imports the real UI/business logic from the root app's `lib/` and
`components/` via the same `@/*` path alias, resolved one directory up (see
`mobile-web/tsconfig.json`). It has no `app/api/**` of its own — that's the whole reason it's a
separate project: `output: "export"` cannot coexist with the root app's API routes in one build.

Required env vars for `mobile-web` (in a gitignored `mobile-web/.env.local` — see
`mobile-web/.env.example`):

| Variable | What it is | Public or secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project the web app uses | Public — safe in a client bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key | Public/RLS-protected by design — safe in a client bundle |
| `NEXT_PUBLIC_API_ORIGIN` | The hosted Installer Sheetz origin (e.g. `https://installer-job-card.vercel.app`) that `lib/api-base.ts`'s `apiUrl()` and `lib/app-routes.ts` target instead of relative same-origin paths | Public hostname — safe in a client bundle |

**Never put a server-only secret in any `NEXT_PUBLIC_*` variable or in `mobile-web/`'s env files** —
`SUPABASE_SERVICE_ROLE_KEY`, any `ZOHO_FSM_*` credential, the webhook secret, and the evidence API
secret must never appear here. None of the screens `mobile-web` currently imports
(`LoginScreen`, `CompaniesScreen`, `ProjectsListScreen`, `ProjectDetailScreen`, `NewSubmissionForm`)
need them — those secrets are used only by `app/api/**` and a few server-only `lib/` modules that
`mobile-web` never imports.

Build it, then sync into the native shell:

```bash
cd mobile-web
npm install        # first time only
npm run build       # produces mobile-web/out/

cd ..
npx cap sync android   # copies mobile-web/out/ into android/app/src/main/assets/public
```

`capacitor.config.ts`'s `webDir` points at `mobile-web/out` directly — there's no separate copy
step. **`CAPACITOR_SERVER_URL` must stay unset** for this packaged build; if it's set (see below),
Capacitor loads that remote URL instead of `webDir` and none of this applies.

## `CAPACITOR_SERVER_URL` — smoke-test escape hatch only, not the real architecture

`capacitor.config.ts` reads `CAPACITOR_SERVER_URL` (shell env var, or from a gitignored
`.env.local` in the repo root) and, if set, uses it as `server.url` — loading a remote URL instead
of the local `mobile-web/out` bundle. **There is no committed default.** Leave it unset for the
normal Phase 1C flow described above.

This override still exists for the case where you want to quickly test against a live deployment
instead of a local static build — e.g. a Vercel Preview Deployment of a branch, or
`http://localhost:3000` (`http://10.0.2.2:3000` for the Android emulator) with `npm run dev`
running:

```bash
# one-off
CAPACITOR_SERVER_URL=https://install-app-git-feature-mobile-shell-<team>.vercel.app npx cap sync

# or persist it locally (gitignored)
echo "CAPACITOR_SERVER_URL=http://10.0.2.2:3000" >> .env.local
npx cap sync
```

After changing it, re-run `npx cap sync` (or `npm run cap:sync`) so the native projects pick up
the new value. Unset it again (remove the line / unset the env var) to go back to loading the real
packaged `mobile-web` bundle.

## Common commands

```bash
npm run cap:sync      # copy web assets + config into android/ and ios/
npm run cap:android    # open the Android project in Android Studio
npm run cap:ios        # open the iOS project in Xcode
```

## Route abstraction (`lib/app-routes.ts`)

The web app uses dynamic file-based routes (`/companies/[companyId]/projects/[projectId]`);
`mobile-web`'s static export can't have those at all, so it uses query-param routes instead
(`/project?companyId=...&projectId=...`). Shared screens never hardcode either shape — they call
`appRoutes.project(companyId, projectId)` etc., which resolves per-build (keyed off the same
`NEXT_PUBLIC_API_ORIGIN` presence check `lib/api-base.ts` uses, since the mobile build is the one
build that always sets it). See that file's comments for the full mapping.

## API origin (`lib/api-base.ts`)

Any shared code calling Installer Sheetz's own `/api/**` routes should use `apiUrl(path)` instead
of a raw relative `fetch(path)`. On the web build (`NEXT_PUBLIC_API_ORIGIN` unset) it returns the
path unchanged — identical same-origin behavior to today. On the mobile build it returns an
absolute URL against the configured origin. As of Phase 1C this is wired into exactly the two API
calls on the proven technician path (Zoho project-progress and project-info); the other ~23
`/api/**` call sites elsewhere in the app still call `fetch()` directly and will need the same
migration before those surfaces are ported to `mobile-web`.

## Native service boundaries

`lib/native/` holds thin interfaces (`camera.ts`, `filesystem.ts`, `secure-storage.ts`,
`network-status.ts`, `outbox.ts`) so future native-specific code has a seam to implement against
instead of the shared UI/business code importing Capacitor plugins directly. As of Phase 1C these
are still boundaries only — not wired into the job-card UI, and the native-side implementations are
stubs that throw until a later phase backs them with real Capacitor plugins.

## Phase 2C — 7-day offline access lease

A technician who has successfully authenticated and been confirmed authorized/active by Installer
Sheetz while online may keep using the **installed native app** without server connectivity for up
to **7 days** from the most recent successful server authorization. This is deliberately a
NATIVE-ONLY capability — the web/PWA build never gets it (see `lib/auth/auth-state.ts`'s module
doc for the explicit `isNative()` gate and why).

The lease record (`lib/auth/offline-access-lease.ts`'s `OfflineAccessLease`) is NOT a server-issued
credential — it's a device-local record, written only after a confirmed-successful online
authorization, stored in OS-backed secure storage (Android Keystore / iOS Keychain via
`lib/native/secure-storage.ts`). It is bound to this specific app installation (`deviceInstallationId`,
see `lib/native/device-installation.ts` — a random, non-hardware-derived id) and carries no
company/project/role/Zoho data of its own; it is only the GATE. Actual offline data stays in the
Phase 2B field package (`lib/active-projects-field-package.ts`), independently keyed by `userId`.

**Trust limitation, explicit:** because the lease is created locally rather than cryptographically
signed by the server, a device whose secure storage is itself compromised (root/jailbreak-level
access) could in principle forge one. The blast radius is bounded to that one device's own
already-downloaded data for one user, self-expiring in 7 days — it grants no new server-side
authority. A server-signed lease (server holds a private key, the app embeds only a public
verification key) is the correct long-term hardening step before broad deployment; it was not built
in Phase 2C because no signing infrastructure (library, key management, an "issue a claim" API
route) exists in this codebase yet, and inventing it without a deployment/ops plan was out of scope.

**Clock safety:** `lastValidatedAt`/`offlineAccessExpiresAt` are still client-clock readings — there
is no server-time endpoint to source them from. `checkLeaseValidity()` in `offline-access-lease.ts`
applies two cheap checks (not a general anti-tamper system): the current time may never be before
the lease's own `issuedAt`, and a ratchet (`lastObservedDeviceTime`) flags a clock rolled backward
past any time this lease has already been checked against. Freezing the clock immediately after
issuance, before ever letting it advance, defeats both — closing that fully needs a server time
source (see the server-signed lease paragraph above).

### Future quarantine contract (design-only — not implemented yet)

Offline submissions/drafts/photos/an outbox do not exist yet in this app. Once they do, the
following contract governs what happens when a device reconnects and Installer Sheetz determines
the user is no longer authorized:

1. Invalidate the offline access lease immediately.
2. Lock access to cached SERVER-DERIVED data (e.g. the Phase 2B field package) — no re-upload
   needed, it simply becomes inaccessible again until re-authorized.
3. Do **not** discard locally-created UNSYNCED technician work (drafts/photos/submissions).
4. Do **not** automatically merge that work into canonical project/job-card records.
5. That unsynced work must become eligible for upload to a future server-side
   INSPECTION/QUARANTINE QUEUE.
6. An authorized reviewer later decides to accept, reject, or correct/reassign each item.

Quarantined records should retain provenance: `originalUserId`, `deviceInstallationId`, `projectId`,
`localSubmissionId`, `createdAtLocal`, `lastModifiedAtLocal`, `leaseIssuedAt`,
`leaseLastValidatedAt`, `leaseExpiresAt`, `revocationDetectedAt`, payload hashes, and sync history —
alongside the actual form/device/photo payload once those systems exist. No inspection-queue
tables, quarantine API, outbox, submissions, or photo-upload flow exist yet; this section is a
design contract for whoever builds that phase, not a description of current behavior.

## Phase 2D — offline Project Detail (Project Work Package)

Once OFFLINE_AUTHORIZED, a technician can open a project already cached in the Phase 2B Active
Projects field package and see its identity/work-context — WITHOUT server access — via a second,
smaller local package: `lib/project-work-package.ts`'s `ProjectWorkPackage`, one row per
`(userId, projectId)`. It is deliberately narrower than the full (online) `ProjectDetailScreen`:
company/project/customer/site/location plus optional Zoho WO#/SA#/summary enrichment — no
expenses (a separate subsystem needing Supabase Storage photo uploads, out of scope) and no Site
Info contact/license/WiFi/notes fields (reference detail, not required to view identity or start a
submission).

**Provisioning (Phase 2D.1) — a technician never has to open a project online first.** Right after
a successful Active Projects sync, `ActiveProjectsScreen.tsx` calls
`provisionProjectWorkPackages(userId, packages)` with a minimal package for EVERY currently-
authorized project — not just ones previously visited. This costs exactly one additional bulk
query (`customer_accounts`, for the optional `customerAccountName` field) beyond what
ActiveProjectsScreen already fetches for the project list itself — no per-project queries, and no
Zoho request at all (every provisioned package starts `zohoLinked: false` with null WO#/SA#/
summary; an actual online Project Detail visit later enriches it — see `saveProjectWorkPackage()`,
called separately from `ProjectDetailScreen`'s own online success/Zoho-fetch effects).

Provisioning is atomic and set-based (`provisionProjectWorkPackages` → native: one `executeSet`
transaction; web: one IndexedDB readwrite transaction): it prunes any package for that user whose
`projectId` is no longer in the authorized set (a project the technician can no longer see stops
being reachable offline after the NEXT successful sync — never immediately, never on a failed
one), and upserts every authorized package WITHOUT clobbering `zoho_*` fields an earlier Project
Detail visit already wrote (the native upsert's `ON CONFLICT` clause simply omits those columns;
web does an explicit read-merge-write). A partial failure — network or local-write — leaves every
previous package, stale or not, completely untouched; the technician's online render is never
blocked or downgraded over it, though `ActiveProjectsScreen` does surface a small truthful "some
project details may not be available offline yet" note when provisioning itself fails but the
project list load succeeded.

Native storage is `project_work_packages` (SQLite, migration version 2). **Migration version
numbers turned out to be GLOBAL** across every native repository (one shared
`mobile_schema_migrations` table on the one shared connection — see `lib/native/database.ts`), not
scoped per file, so every native package's schema now lives in one canonical, ordered catalog,
`lib/native/mobile-migrations.ts`'s `MOBILE_MIGRATIONS` — see that file's doc comment for the
initialization-order and duplicate-version-number hazards this consolidation closes. Web mirrors
the store via a new IndexedDB store, `INSTALLER_OFFLINE_DB_VERSION` 5, with an additional `userId`
index (needed to enumerate/prune one user's packages during bulk provisioning).

**Server-load-failure fallback**, unchanged: whenever `ProjectDetailScreen` itself loads a project
successfully online (independent of the bulk provisioning above), it best-effort re-persists
(upserts, WITH real Zoho fields this time) that project's package. A local save failure never
blocks the online render. A subsequent *server* load failure with a valid local package for that
exact `(userId, projectId)` renders the cached copy, truthfully tagged offline/cached; with no
local package, an honest unavailable state.

**Start New Submission while offline**: `ProjectDetailScreen` replaces the link with truthful copy
("Submission setup is not yet available offline for this project.") when OFFLINE_AUTHORIZED, and
`mobile-web/app/new-submission/page.tsx` carries the same guard directly (deep link / back-button
safety) — the full form's online-only dependencies aren't part of this phase.

**Scope boundary, explicit**: Phase 2D provides CORE offline Project Detail (identity + optional
Zoho display enrichment) — it does NOT mean every Project Detail panel is offline-capable. Expenses
stay a truthful "requires an internet connection" panel (a separate subsystem needing Supabase
Storage photo uploads). Site Info — WiFi credentials, license keys, site contact info, notes — also
stays online-only for now, and deliberately so: those are potentially sensitive fields that
shouldn't casually land in plain SQLite just to make one panel work offline. Whether/how to store
Site Info locally (encryption? a narrower field subset? explicit opt-in?) is left as its own future
local-data/security decision, not something this phase's cleanup should quietly resolve by
omission.
