# Blaxtair Demo — Duplicate Detection, Photo Retention, Device History

Living document for the duplicate/reuse-prevention work built on top of the local Blaxtair AHD
OCR demo (`/prototype/blaxtair-demo`, feature-flagged, no DB/Storage writes). Covers what was
built and tested in that local prototype, and specifies the production architecture it maps to.

**Git status at handoff:** local branch, not merged, not deployed. Registries below live in
`localStorage` on the technician's own browser only.

---

## Status legend

| Status | Meaning |
|--------|---------|
| **Built + tested here** | Implemented in the local prototype, covered by unit tests and a live browser walkthrough |
| **Documented only** | Specified below for the production build; not buildable in this single-draft, no-backend local demo |

---

## Four distinct concepts

The rest of this doc keeps these separate on purpose — a match in one is never treated as a
match in another:

1. **Photo reuse** — has this exact photo content appeared before, anywhere, in any category?
2. **Device reuse** — has this (part number, serial number) been installed before, and where?
3. **Draft matching** — does this match something the technician (or another technician) already
   has in progress, not yet submitted?
4. **Revision/correction chain** — is this a legitimate resubmission of the same job, not a new,
   unrelated one?

---

## 1. Photo reuse — Built + tested here (device-label path only; designed to generalize)

### Prototype implementation

- `lib/prototype/photo-fingerprint.ts` — `sha256Hex()` (pure, content bytes → hex digest),
  `fingerprintBlob()`, `fingerprintSource()`. Hashes the **original captured/uploaded file
  bytes**, never a re-encoded canvas (canvas JPEG re-encoding is lossy and not byte-stable
  across runs, which would make the same physical photo hash differently each time) and never
  the filename.
- `lib/prototype/photo-dedup-registry.ts` — `PhotoUseRecord { fingerprint, jobCardId, category,
  fieldLabel, usedAt }`, `findPhotoReuse()`, `upsertPhotoUseRecords()`, plus `localStorage`
  read/write wrappers (`blaxtair-photo-use-registry-v1`).
- `PhotoCategory` already lists every category a real job card needs (`device_label`,
  `power_connection`, `ground_connection`, `device_mounting`, `camera_placement`, `vin`,
  `odometer`, `vehicle_overview`, `completed_installation`, `other`) — this demo only ever
  writes `device_label` records (the one real photo path it has), but the matching functions
  take no label-scan-specific input. Wiring a second photo field anywhere in the app means
  calling the same two functions with a different category, nothing else changes.
- Wired into `BlaxtairOcrDemoPanel.tsx`'s `runScan()`: fingerprint is computed **before OCR
  runs**, so a blocked photo never wastes time on Tesseract.
  - Same-form check: `findDuplicatePhotoInSystem()` (`lib/prototype/label-scan/blaxtair-draft.ts`)
    against every other component's `labelPhoto.contentFingerprint` in the current system.
  - Cross-job check: `findPhotoReuse()` against the local registry, excluding the current
    system's own id.
- Exact messages (verified live):
  - Same form: *"This photo has already been added to this job card. Please use a different
    photo."*
  - Different, completed job card: *"This photo was previously submitted on another job card.
    Please take or select a new photo showing this installation."*
- Recorded into the registry only on **Complete Installation** (Review screen) — matching the
  real-world moment a job actually becomes "submitted," not every intermediate save.

### Known limitation (by design, not a bug)

SHA-256 of exact bytes only catches **the same file reused verbatim**. It will not catch a
re-compressed, re-cropped, or otherwise re-encoded copy of a visually similar photo. That needs
perceptual/near-duplicate hashing (e.g. pHash/dHash with a similarity threshold), which is a
reasonable production enhancement layered on top of the same matching architecture, not a
different one.

### Production integration points

| Concern | Production design |
|---|---|
| **Fingerprint computation** | Compute at upload time, server-side (or client-side before upload, re-verified server-side) — never trust a client-supplied hash alone for anything that gates a block. |
| **Storage** | A global table, e.g. `job_card_photo_fingerprints(fingerprint, job_card_id, revision_id, category, field_label, storage_path, technician_id, used_at)`, indexed on `fingerprint`. Not scoped to one company/technician — reuse detection must see across the whole tenant (or globally, depending on the abuse model). |
| **Check timing** | On upload, before the file is accepted into the draft — same "fail fast, before wasting the technician's time" principle already used in the prototype (check before OCR). |
| **Same-form / draft / cross-job / revision-chain distinction** | Same logic shape as the prototype (`excludeJobCardId` parameter), but "job card" becomes "current submission or draft id," and an additional check against the **revision chain** (see §4) must return "allow" before falling through to the cross-job "block." |
| **Replacing the local simulation** | Swap `loadPhotoUseRegistry()` / `savePhotoUseRegistry()` for API calls; `findPhotoReuse()` / `upsertPhotoUseRecords()` stay as-is — they're pure and already backend-agnostic. |

---

## 2. Device reuse — Built + tested here

### Prototype implementation

- **Same-form key fix**: `findDuplicateDeviceInSystem()` (`blaxtair-draft.ts`) now keys on
  **normalized (part number, serial number)** via `normalizeDeviceKey()` — trims + uppercases
  both for comparison only, never rewrites a stored value. Two different device types that
  happen to share a serial number no longer collide. Same normalization function is reused by
  the cross-form registry, so both checks agree on identity.
- **Cross-form registry redesigned as an installation-history event log**, not a permanent
  "used" flag — `lib/prototype/label-scan/blaxtair-install-registry.ts`:
  - `DeviceInstallationEvent { id, partNumber, serialNumber, systemId, componentId,
    componentLabel, status: "installed"|"removed"|"transferred"|"reinstalled", installedAt,
    previousSystemId? }`.
  - `getCurrentInstallation()` — the **derived** "device registry" view: latest event for a
    device key. This is the pattern the production schema should follow too (§ table below):
    the registry is a *view* over history, not a separate mutable flag that can drift out of
    sync with reality.
  - `getDeviceHistory()` — full chronological history for a device key (what an admin
    device-detail screen would show).
  - `findCrossFormInstall()` — is this device's *current* installation under a different
    system? (Re-completing the same job is never flagged as reuse.)
  - `appendInstallationEvents()` — history is append-only; nothing is ever edited in place.
- On a cross-form match, the technician is prompted (verified live): *"This camera (SN: X, PN:
  Y) was already installed on [date] as [component] on a different form. Is it being
  reinstalled on a new asset?"* — **Yes** proceeds and stamps
  `component.installDetails.reinstalledFromPreviousForm = true` plus a reference to the prior
  install; **Cancel** leaves the component unconfirmed.
- **Complete Installation** appends one event per confirmed component with a serial, tagged
  `"reinstalled"` when the technician confirmed a cross-form prompt, `"installed"` otherwise.

### Production integration points

| Concern | Production design |
|---|---|
| **Device registry table** | `devices(part_number, serial_number, ...)` — or simply a derived view, since the registry is "latest history event" logically, not independent state. Primary/unique key: normalized `(part_number, serial_number)`. |
| **Installation history table** | `device_installation_history(id, part_number, serial_number, job_card_id, component_id, component_label, status, asset_id, installed_at, previous_asset_id, technician_id)`. Append-only; a correction is a new row, never an `UPDATE`. |
| **"Current installation" view** | `SELECT DISTINCT ON (part_number, serial_number) * FROM device_installation_history ORDER BY part_number, serial_number, installed_at DESC` (or equivalent) — exactly what `getCurrentInstallation()` computes locally today. |
| **Cross-technician / cross-device correctness** | The prototype's registry only sees this browser. Production must query the shared table so Technician B sees Technician A's install from yesterday — this is the main thing local `localStorage` cannot simulate. |
| **Replacing the local simulation** | Swap `loadInstallationHistory()` / `saveInstallationHistory()` for API calls; `getCurrentInstallation()`, `getDeviceHistory()`, `findCrossFormInstall()`, `appendInstallationEvents()` stay as-is. |

---

## 3. Draft matching — Built + tested here (as of the full job-card phase)

**Update:** the single-draft limitation below was true for the equipment-only demo. The full
job-card phase (see `docs/Blaxtair_Demo_Full_Job_Card.md`) added a real multi-draft store
(`lib/prototype/blaxtair-draft-store.ts`, `blaxtair-demo-drafts-v1`), so there is now a genuine
second draft to match against, and the workflow below is built and verified live, not just
specified. Cross-*technician* draft detection remains documented-only — see the note below.

### Original reasoning (equipment-only demo, now superseded)

this demo has exactly one draft slot
(`blaxtair-ocr-demo-draft-v1` in `localStorage`) and no concept of multiple named jobs, multiple
technicians, or authentication. There is no *second* draft to distinguish from "the current
form" — resuming the one draft this demo has is already the entire feature ("Resumed from your
last local draft," already built). Simulating "another draft exists" would mean building a
multi-draft picker UI that doesn't exist anywhere in this app today, which is out of scope for
extending the current prototype. Documenting the intended design instead, per your instruction.

### Production workflow (now built and tested locally)

- Photo fingerprints and (part number, serial number) pairs are checked against the current
  technician's **other open cloud drafts**, not just completed submissions.
- A match in one of *your own* drafts prompts:
  > "Some of this information already exists in a saved draft for this installation. Would you
  > like to continue the previous draft or discard it and continue here?"
  >
  > **Continue previous draft** · **Discard previous draft and continue here** · **Cancel**
  - Discard must show an explicit warning before deleting the other draft's saved work.
- A match in **another technician's** draft must not be silently discardable by the current
  technician. The system should surface that another draft exists and require an admin/
  coordination decision — this is an authorization concern, not a client-side UX one, and needs
  a real backend check (who owns which draft) that a local demo has no way to represent
  honestly.

### Production integration points

| Concern | Production design |
|---|---|
| **Where drafts live** | Already cloud-backed per `docs/Architecture.md` ("Cloud drafts (Supabase)") — the check queries that store, not `localStorage`. |
| **Ownership check** | Draft rows need a technician/owner id; the "is this mine?" branch of the prompt logic is an authorization check against that column, not a client heuristic. |
| **Matching inputs** | Same fingerprint + device-key functions as §1/§2 — only the query source changes (drafts table in addition to submitted-job-cards table). |

---

## 4. Revision / correction chain — Built + tested here (as of the full job-card phase)

**Update:** the "no submission concept" limitation below was true for the equipment-only demo.
The full job-card phase (see `docs/Blaxtair_Demo_Full_Job_Card.md`) added a real completed-
submissions store (`lib/prototype/blaxtair-submission-store.ts`) with "Create Corrected
Revision," so this is now built and verified live: a revision copies the original's photos and
equipment, increments `revisionNumber`, links `supersedes`, and — critically — completing the
revision does **not** re-flag the inherited photos or device identifiers as reuse, because the
whole chain's job-card ids are excluded from the cross-submission checks.

### Original reasoning (equipment-only demo, now superseded)

this demo has no submission concept at all (nothing is ever finalized
into a real job card), so there's nothing to link a "revision" to. Documenting the intended
design per your instruction.

### Production model (now built and tested locally)

A correction creates a **new revision linked to the original**, not an unrelated second
submission:

- `original_submission_id`
- `revision_number`
- `reason_for_correction`
- `revised_by`, `revised_at`
- `supersedes` (the prior revision or original submission id)
- a diff of which fields/photos/equipment entries changed

Photos and device identifiers **inherited unchanged from the linked original** are allowed to
reappear — they're expected to match, because they're the same installation, not new evidence
being passed off as something else. The original and every intermediate revision stay preserved
for audit history; the newest approved revision is the one treated as "current."

### How this changes the matching rules from §1/§2

| Scenario | Behavior |
|---|---|
| Duplicate elsewhere on the current form | Block |
| Match in a saved draft | Prompt to continue or resolve (§3) |
| Match in the **linked original submission or an earlier revision in the same chain** | **Allow** |
| Matching photo on an unrelated completed job card | Block |
| Matching (part number, serial number) from a prior, unrelated installation | Ask whether the device is being transferred/reinstalled (§2) |

The "allow within chain" branch is the one piece that doesn't exist in §1/§2's logic today —
both `findPhotoReuse()` and `findCrossFormInstall()` take an `excludeJobCardId`/
`excludeSystemId` parameter already; production would extend that exclusion to "the whole
revision chain's ids," not just the one current id, before falling through to a block.

---

## Photo retention: thumbnail vs. full-quality (production integration point)

The prototype's `labelPhoto.localPreview` is a **bounded ~480px-wide JPEG thumbnail**
(`canvasToThumbnailDataUrl()`), chosen specifically to stay well under `localStorage`'s
per-origin quota (a handful of full-resolution photos would blow past it immediately). This is
correct and sufficient for local display in this prototype — **it must not become the only
image retained in production.**

| Step | Prototype (today) | Production |
|---|---|---|
| Capture | Original file or synthetic canvas | Same |
| Fingerprint | Hash of original bytes (§1) | Same — compute before/at upload |
| Full-quality image | Discarded after generating the thumbnail | **Uploaded to Supabase Storage** (`customer-site-files`-style private bucket, namespaced by system/component UUID per the existing `photoNamespace()` convention in `lib/product-devices/merge.ts`) |
| Reference on the component | `labelPhoto.localPreview` (data URL) | `labelPhoto.storagePath` (Storage object key) + `publicUrl`/signed URL as needed — `LabelPhotoRef` already has these fields |
| Thumbnail | Same field, same size | **Retained as a supplement**, generated from the uploaded original, for fast display without fetching the full image every time |
| Display while validating OCR fields | ✅ shown in the scan-review step | Same, but sourced from the upload response rather than a local blob |
| Display when component section is expanded | ✅ shown (built this session) | Same, but resolve `storagePath` → signed URL (or serve the thumbnail first, full image on request) |
| On the completed job card / submission output | Not applicable — this demo never submits | **Must include or link the full-quality image**, not just the thumbnail |

`LabelPhotoRef.contentFingerprint` (added this session) is the field that makes all of the above
consistent: prototype and production both populate it the same way, at the same point in the
flow, regardless of where the pixels end up being stored.

---

## Summary: what changed this session

| File | What |
|---|---|
| `lib/prototype/label-scan/blaxtair-draft.ts` | Added `normalizeDeviceKey()`; renamed/refactored `findDuplicateSerialInSystem` → `findDuplicateDeviceInSystem` (part+serial key); added `findDuplicatePhotoInSystem()` |
| `lib/prototype/label-scan/blaxtair-install-registry.ts` | Replaced flat upsert-by-system record with an append-only `DeviceInstallationEvent` history + derived `getCurrentInstallation()`/`getDeviceHistory()` views |
| `lib/prototype/photo-fingerprint.ts` | New — content-hash fingerprinting, generic (not label-scan-specific) |
| `lib/prototype/photo-dedup-registry.ts` | New — generic cross-job-card photo reuse registry, all photo categories |
| `lib/product-devices/types.ts` | Added `LabelPhotoRef.contentFingerprint` (additive, optional) |
| `components/product-devices/BlaxtairOcrDemoPanel.tsx` | Wired photo fingerprint check before OCR; device same-form check now part+serial; cross-form prompt now event-log-backed; Complete Installation records both device history and photo-use registries |

## Related

- [Architecture.md](./Architecture.md) · [Product_Devices.md](./Product_Devices.md) ·
  [OCR_Strategy.md](./OCR_Strategy.md) · [Roadmap.md](./Roadmap.md)
