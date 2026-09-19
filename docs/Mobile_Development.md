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
expenses (a separate subsystem needing Supabase Storage photo uploads, out of scope) and, as
originally shipped, no Site Info fields at all. Phase 2E below narrowly added exactly three Site
Info contact fields (`primaryContact`/`contactNumber`/`contactEmail`) once they turned out to be
genuine blank-submission prefill requirements — every other Site Info field (license/WiFi/notes)
remains excluded, unchanged from this paragraph's original scope.

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

Native storage is `project_work_packages` (SQLite, migration version 2; Phase 2E's migration
version 3 later added three columns to this same table — see below). **Migration version
numbers turned out to be GLOBAL** across every native repository (one shared
`mobile_schema_migrations` table on the one shared connection — see `lib/native/database.ts`), not
scoped per file, so every native package's schema now lives in one canonical, ordered catalog,
`lib/native/mobile-migrations.ts`'s `MOBILE_MIGRATIONS` — see that file's doc comment for the
initialization-order and duplicate-version-number hazards this consolidation closes. Web mirrors
the store via an IndexedDB store, originally `INSTALLER_OFFLINE_DB_VERSION` 5, with an additional
`userId` index (needed to enumerate/prune one user's packages during bulk provisioning).

**Server-load-failure fallback**, unchanged: whenever `ProjectDetailScreen` itself loads a project
successfully online (independent of the bulk provisioning above), it best-effort re-persists
(upserts, WITH real Zoho fields this time) that project's package. A local save failure never
blocks the online render. A subsequent *server* load failure with a valid local package for that
exact `(userId, projectId)` renders the cached copy, truthfully tagged offline/cached; with no
local package, an honest unavailable state.

**Start New Submission while offline** (superseded by Phase 2E — see below for the current guard):
as originally shipped in Phase 2D, `ProjectDetailScreen` unconditionally replaced the link with
"Submission setup is not yet available offline for this project." whenever OFFLINE_AUTHORIZED,
since the full form's offline dependencies didn't exist yet.

**Scope boundary, explicit**: Phase 2D provides CORE offline Project Detail (identity + optional
Zoho display enrichment) — it does NOT mean every Project Detail panel is offline-capable. Expenses
stay a truthful "requires an internet connection" panel (a separate subsystem needing Supabase
Storage photo uploads). Site Info beyond Phase 2E's three contact fields (below) — WiFi
credentials, license keys, notes — stays online-only, and deliberately so: those are potentially
sensitive fields that shouldn't casually land in plain SQLite just to make one panel work offline.
Whether/how to store the REST of Site Info locally (encryption? explicit opt-in?) is left as its
own future local-data/security decision, not something a later phase's cleanup should quietly
resolve by omission.

## Phase 2E — offline New Submission (Submission Definition Package)

Once OFFLINE_AUTHORIZED with both packages described below present for the selected project, "Start
New Submission" opens `/new-submission` and renders the exact same blank Installer Sheetz form the
online path would, using only locally provisioned definitions — zero required Supabase/Zoho/API
calls. Phase 2E deliberately stops at rendering a correct blank form: durable draft data, photo
capture/upload, and submission sync remain later phases (see `NewSubmissionForm.tsx`'s own
`navigator.onLine`/`starter-data-cache` fallback for the pre-existing, untouched web/PWA offline
path, which this phase leaves alone).

**Two packages, two owners.** Following a code-verified dependency audit of
`NewSubmissionForm.tsx`'s blank-form startup path (company name, project/customer/contact autofill,
Zoho prefill, and the hybrid product catalog — `useCompanyProducts()` /
`resolveCompanyProducts()`), exactly two additions were needed, each reusing an existing owner
rather than inventing a new one:

1. **Three contact fields added to the existing `ProjectWorkPackage`** (`lib/project-work-package.ts`,
   schema version 2; native migration version 3 — `ALTER TABLE project_work_packages ADD COLUMN
   primary_contact/contact_number/contact_email TEXT`): `primaryContact`/`contactNumber`/
   `contactEmail`. These are the ONLY three Site Info fields ever cached locally, added because
   `NewSubmissionForm`'s core-job autofill genuinely requires them for offline parity — no other
   Site Info field (WiFi, license keys, notes, other contact metadata) was added, and adding one
   requires the same explicit review this decision went through. Unlike Zoho's `zoho_*` columns,
   these are treated as ordinary identity fields: always overwritten by both the online save path
   and bulk re-provisioning (never preserve-on-conflict), since they come from the exact same
   `customers` join as `customerName`/`location`.

2. **A new company-scoped `CompanyProductDefinitionsPackage`**
   (`lib/product-config/company-product-definitions.ts` / `lib/native/company-product-definitions.ts`,
   native migration version 4 — `CREATE TABLE company_product_definitions`): one row per
   `companyId` (deliberately NOT per-user — the product catalog is shared by every technician under
   a company, so caching it once avoids redundant storage and N+1 provisioning). It stores the RAW
   `company_form_products` rows exactly as `/api/company-products` would return them — never a
   pre-normalized shape — so `resolveCompanyProducts()` (already pure/injectable) can be reused
   completely unchanged for both the online and offline paths; only `useCompanyProducts()`'s
   `fetchProducts` implementation branches on `isOfflineAuthorized`, reading this package instead of
   calling the API. A row is written EVEN WHEN a company has zero custom products (`rows: []`) —
   that written-but-empty row is the signal distinguishing "checked, genuinely zero products,
   registry fallback is correct" from "never checked," which the offline guard below depends on.

**Provisioning** is proactive, exactly like Phase 2D.1: `ActiveProjectsScreen.tsx`, right after a
successful sync, does ONE additional bulk query — `company_form_products` filtered `.in("company_id",
companyIds)` — covering every authorized company in a single request (never one query per
company/project, never through `/api/company-products`), then writes one `CompanyProductDefinitionsPackage`
row per authorized company (empty-seeded for every company first, so a company with zero rows still
gets its empty-array row written). The three contact fields ride along on the SAME bulk `customers`
join `ActiveProjectsScreen` already performs for `customerName`/`location` — no new query for those.
A technician never has to open a project or New Submission online first for any of this.

**The offline guard**, evolved from Phase 2D's blanket block: both `ProjectDetailScreen.tsx`'s "New
Submission" card and `mobile-web/app/new-submission/page.tsx` (defense in depth against a deep link
or stale bookmark) now require BOTH a valid `ProjectWorkPackage` for the selected project AND a
synced `CompanyProductDefinitionsPackage` for its company before allowing/rendering the form —
package existence alone is never treated as authorization; the underlying lease/authorized-project
checks from Phase 2C/2D still gate everything beneath this. Missing either package shows: "Submission
setup for this project hasn't been saved to this device yet. Connect to the internet to synchronize
it." The web/PWA `app/new-submission/page.tsx` carries no such guard — `authMode` can never be
`"offline-authorized"` there (`resolveAuthState` gates that mode behind `isNativeRuntime()`), so the
condition it would guard against cannot occur on web.

**One shared view-model boundary.** `NewSubmissionForm.tsx` reads `authMode` from
`useAuthUserContext()` and adds an authoritative `authMode === "offline-authorized"` branch, checked
BEFORE the pre-existing `navigator.onLine`/`starter-data-cache` fallback (left untouched, still the
web/PWA path), to its company-name-loading effect and its project/Zoho-autofill effect. The
offline-authorized branch reads the local `ProjectWorkPackage` and — for Zoho fields — constructs the
same `ZohoProjectInfoViewModel` shape and feeds it through the SAME `mergeZohoPrefillIntoCoreJob()`
the online path uses, so there is exactly one interpretation of "what Zoho prefill means," never a
second offline-only one.

**Scope boundary, explicit**: Phase 2E renders a correct BLANK form only. It does not implement
durable offline draft data, offline asset/progress tracking, native photo capture or file
persistence, a submission outbox, background sync, conflict reconciliation, a quarantine API, or an
inspection queue — all left to later phases.

**Developer Sheets is not part of this**: a separate, unmerged `feature/developer-sheets` branch
exists (collaborative product-documentation cards, not job-card submissions — deliberately its own
domain, never counted as an installation submission). Nothing from it is ported or merged here.
Its current design (as of that branch) is a fixed-schema record, not a dynamic field/type/options
system, but even if it later grew one, Phase 2E's package pattern doesn't assume
`company_form_products` is the only possible form-definition source: `CompanyProductDefinitionsPackage`
is scoped specifically to the installer job-card product catalog. A future Developer Sheets offline
need would get its own new package following the same proven shape (entity-scoped, raw-row caching,
a `MOBILE_MIGRATIONS` catalog entry) — no redesign of the offline authorization/guard architecture
required.

## Phase 2F — durable local submission/draft state

Once a technician opens a blank offline form (Phase 2E), Phase 2F makes the STRUCTURED work they
type into it durable on native — surviving force-stop/reopen and a full emulator restart — without
depending on the network as a durability boundary. It does not touch photo files, upload,
synchronization, or the future outbox; see the scope boundary below.

**Re-baseline first.** Before designing anything, the existing `buildCurrentDraftData()` function in
`components/NewSubmissionForm.tsx` was audited end to end: it already assembles nearly the entire
structured-work state (coreJob, hardwareSelection, the per-product field bags — `vac4`/`ppd`/`cp4`/
`linxup`/`sscSpeed` — and `installedProductSystems`) into one coherent JSON-shaped object, already
reused by the Cloud Draft save, the manual "Save to this device" IndexedDB draft, and the 4-second
`localStorage` autosave. Phase 2F reuses this exact shape rather than inventing a new one. Also
confirmed: no "Next Asset"/multi-asset-within-one-submission concept exists anywhere in the app —
one submission is one vehicle/unit; multiple assets for a project means multiple independent
submissions, which the new architecture below handles as multiple independent rows. Also confirmed:
`/drafts`, `/offline-drafts`, `/submitted` exist only in the root web app, not in `mobile-web/` — the
native shell has no drafts-list page, which is why the resume choice below is inline rather than a
separate page.

**`lib/local-submission.ts` / `lib/native/local-submission.ts`** — a new `LocalSubmissionRepository`,
mirroring every other Phase 2B–2E repository's native/web dispatch shape, but native-only in its
actual integration: `NewSubmissionForm.tsx` only ever calls it on the authoritative
`authMode === "offline-authorized"` branch, which can never be true on web (`isNativeRuntime()`
gate). Web's implementation therefore throws — mirroring `lib/native/database.ts`'s
`WebDatabaseNotImplemented` precedent exactly — rather than duplicating a redundant, never-used
IndexedDB store; web keeps its existing IndexedDB draft mechanism, `localStorage` autosave, and Cloud
Draft entirely unchanged. **No IndexedDB version bump was needed.**

Native storage is one table, `local_submissions` (SQLite, migration version 5 in
`MOBILE_MIGRATIONS`), deliberately not over-normalized: the structured per-product field bags live in
one JSON `payload` column (nothing in that shape needs independent SQL querying — no cross-submission
photo/device queries exist), while identity/status columns are normalized because
`(user_id, project_id, status)` genuinely needs to be queried for the resume flow:

```sql
CREATE TABLE local_submissions (
  local_submission_id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, company_id TEXT,
  status TEXT,               -- 'working' | 'locally-complete'
  form_id TEXT, submission_type TEXT, definition_schema_version INTEGER,
  selected_sections TEXT,    -- JSON array
  payload TEXT,              -- JSON: same StoredJobCardDraft["data"] shape
  server_submission_id TEXT, -- always NULL in Phase 2F; future sync only
  created_at TEXT, updated_at TEXT
);
```

**Identity**: `localSubmissionId` reuses the EXISTING `submissionId`/`generateSubmissionId()`
(already `crypto.randomUUID()`-based, already what `job_card_submissions.submission_id` uses as its
idempotency key) — not a third parallel ID. What changed is durability timing: it's now persisted
immediately on mount (offline-authorized, no existing resumable submission) instead of only once some
save action fires.

**Resume flow**: on mount, offline-authorized, `findWorkingLocalSubmissions(userId, projectId)` runs
against the new table. Zero results → create+persist immediately, render the blank form. One or more
→ an inline "Resume unfinished entry?" prompt (mirroring the existing `/offline-drafts` Resume
concept, scoped to this project) lists each by customer/unit/last-saved, with a "Start Another
Submission" fallback — never a silent overwrite of unsaved work.

**Write policy**: `persistLocalSubmissionNow()` is the one write path, reused for creation, ongoing
saves, and status transitions. A 1.5s interval safety net covers free-text edits (deduped against the
last-persisted snapshot, so an idle form issues zero SQLite writes between ticks); product/section/
step changes flush immediately, not on the interval; explicit actions ("Save to this device", leaving
the page) flush as an additional opportunity, never the sole mechanism. **Maximum expected crash-loss
window: ~1.5 seconds** of the most recent keystroke burst — anything structural is already zero-loss.

**Lifecycle**: `working` = the technician is actively editing structured local work.
`locally-complete` = the local structured form passed `collectReviewValidationIssues()` — the SAME
full validation gate the online path already enforces (every required core/vehicle/product field,
every required photo slot has at least one *locally-selected* file) — at that point in time, while
offline-authorized. Reverts to `working` automatically if the technician returns to Edit.

**`locally-complete` does NOT mean** — and must never be read by any future code as meaning —
submitted to the server, accepted by the server, queued for upload, that photos are durably
available, or that the record is safe for automatic synchronization. `serverSubmissionId` stays
`null` throughout Phase 2F regardless of status. It is also not a durability guarantee about photo
*bytes*: a required photo slot only needs a local `File` selected at the moment of the transition
(never persisted — see the photo boundary below); if that in-memory selection is lost to a later
force-stop, status stays `locally-complete` (a truthful record of what was true when it was set) even
though the visible form would show that slot empty again on resume. **Until native photo persistence
exists, any future outbox/sync logic MUST NOT treat `locally-complete` alone as "ready to upload."**

**Offline completion, not offline submission**: both "Confirm & Submit" buttons now disable on
`isOfflineAuthorized` (not just raw `isOffline` — the same "connected but server-unreachable" edge
case Phase 2E's audit surfaced) and show truthful copy — *"Saved on this device"* / *"Will be ready to
sync when synchronization is enabled."* The Cloud Draft save (`handleSaveDraft`) and "Save Draft and
Exit" got the identical `isOfflineAuthorized` guard extension. No outbox is built; no offline
completion is ever sent to the server in this phase.

**Authorization removal and logout lock access, they never delete local work.** A `LocalSubmission`
row is technician-created data, not a cache — nothing in this phase ever deletes one because a
project drops out of the user's authorized `ProjectWorkPackage`/`ActiveProjectsFieldPackage` set, or
because the `OfflineAccessLease` is cleared (explicit logout) or expires. Neither pruning path
(`provisionProjectWorkPackages`, `saveActiveProjectsSnapshot`) nor `clearLease()` touches
`local_submissions` at all — they're entirely separate tables/stores. What changes is reachability:
with the project no longer authorized (or no valid lease at all), `/installs` won't list it, `/project`
fails closed ("hasn't been saved to this device yet"), and `/new-submission`'s own guard means
`NewSubmissionForm` never mounts — so the resume-detection effect that would surface the local
submission never runs. The row itself, verified live via direct `LocalSubmissionRepository` queries,
survives byte-for-byte (same id, same timestamps, same payload) through both scenarios, and becomes
normally resumable again — without creating a duplicate — the moment the project is re-authorized or
the same user re-authenticates. This is required groundwork for a future quarantine/recovery model;
there is deliberately no hidden UI path that would let a technician bypass normal authorization to
reach an unauthorized project's local work — a `LocalSubmission` row's mere existence is never itself
treated as authorization, the same principle `CompanyProductDefinitionsPackage` already established.

**Definition-version handling**: each local submission records the `CompanyProductDefinitionsPackage`
schema version in effect at creation, for diagnostics only — Phase 2F does not implement
definition-version migration. A resumed submission always keeps showing its own entered values;
prefill from `ProjectWorkPackage`/definitions applies only at creation (`restoredFromDraftRef`
already suppresses every prefill effect once a submission is resumed, exactly as it already did for
the pre-existing web draft-resume path).

**Scope boundary, explicit**: no photo/file Blob bytes ever enter `local_submissions.payload` —
`photoUploads`/`productFiles` stay storage-path references only (empty until a real online upload,
out of scope here), and `photoRestoreSupported`-style claims stay truthfully absent for native
records. No durable native photo capture, upload, submission outbox, background sync, conflict
reconciliation, quarantine API, or inspection queue — all left to later phases.
