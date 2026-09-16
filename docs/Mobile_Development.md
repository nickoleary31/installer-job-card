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
