# Mobile Development (Capacitor)

Status: **Phase 1A — native shell smoke test.** The native shell (`android/`, `ios/`) currently
loads its UI from a remote URL controlled by `capacitor.config.ts`, not from locally packaged
assets. See that file's comments for the full rationale. Local UI packaging is Phase 1B.

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

Once those are in place:

```bash
cd android
./gradlew assembleDebug
```

produces a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`.

iOS builds require Xcode on macOS — nothing here has been build-verified on iOS yet.

## Pointing the native shell at something to load

`capacitor.config.ts` reads `CAPACITOR_SERVER_URL` (shell env var, or from a gitignored
`.env.local` in the repo root) and uses it as `server.url`. **There is no committed default** — if
it's unset, the app loads the local `www/index.html` placeholder instead of any remote app. This is
deliberate: the native shell must never silently load Production, since Phase 1A's
native-runtime/service-worker changes only exist on `feature/mobile-shell` and Production doesn't
have them.

Set it to one of:

- **A Vercel Preview Deployment of `feature/mobile-shell`** (or whichever branch you're testing) —
  the normal case, since that's the only place this branch's changes actually run.
- **`http://localhost:3000`** with `npm run dev` running, for local iteration. Use
  `http://10.0.2.2:3000` instead of `localhost` when targeting the Android emulator specifically —
  the emulator's network is separate from the host machine's.

```bash
# one-off
CAPACITOR_SERVER_URL=https://install-app-git-feature-mobile-shell-<team>.vercel.app npx cap sync

# or persist it locally (gitignored)
echo "CAPACITOR_SERVER_URL=http://10.0.2.2:3000" >> .env.local
npx cap sync
```

After changing it, re-run `npx cap sync` (or `npm run cap:sync`) so the native projects pick up
the new value.

## Common commands

```bash
npm run cap:sync      # copy web assets + config into android/ and ios/
npm run cap:android    # open the Android project in Android Studio
npm run cap:ios        # open the iOS project in Xcode
```

## Native service boundaries

`lib/native/` holds thin interfaces (`camera.ts`, `filesystem.ts`, `secure-storage.ts`,
`network-status.ts`, `outbox.ts`) so future native-specific code has a seam to implement against
instead of the shared UI/business code importing Capacitor plugins directly. As of Phase 1A these
are boundaries only — not wired into the job-card UI, and the native-side implementations are
stubs that throw until a later phase backs them with real Capacitor plugins.
