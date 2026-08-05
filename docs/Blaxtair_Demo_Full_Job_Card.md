# Blaxtair Demo — Full Job Card Workflow

Living document for the complete, end-to-end local job-card demo built on top of the Blaxtair AHD
OCR prototype (`/prototype/blaxtair-demo`, feature-flagged, no DB/Storage/email writes). This
extends `docs/Blaxtair_Demo_Duplicate_Detection.md` (photo/device reuse, revision chains) into a
full 7-stage installation job card: Job/Site → Vehicle → Equipment → Connections → Photos → Notes
→ Review → Complete.

**Git status at handoff:** local branch, not merged, not deployed. Everything below lives in
`localStorage` on the technician's own browser only — nothing is uploaded, submitted, or written
to Supabase.

---

## 1. What already existed vs. what this phase added

| Area | Status before this phase | Status after this phase |
|---|---|---|
| Camera/monitor OCR capture, manual fallback, mounting/view fields | Built (equipment-only demo) | Unchanged — now one stage (`equipment`) inside the full job card |
| Same-form device duplicate (PN+SN) | Built | Unchanged |
| Cross-form device installation history + reinstall prompt | Built | Unchanged — now fires from the `equipment` stage of a real multi-stage job card |
| Photo fingerprinting + cross-job-card reuse | Built (device-label photos only) | Extended to **every** required photo category, wired generically via `PhotoField`/`PhotoGallerySection` |
| Draft matching (continue/discard/cancel prompt) | Documented only (single-draft demo had nothing to match against) | **Built and tested** — the demo now supports multiple named drafts, so a real match/prompt exists |
| Revision/correction chains | Documented only (no submission concept existed) | **Built and tested** — `Create Corrected Revision` on a completed submission |
| Job/site/customer info, vehicle/asset info, connection details, technician notes | Did not exist | New sections/stages |
| Review screen, Complete Demo Submission, Completed Demo Submissions view | Did not exist | New |

`docs/Blaxtair_Demo_Duplicate_Detection.md` §3 and §4 are updated with pointers here now that both
are actually built — see that file's status table.

---

## 2. Data model

`lib/prototype/blaxtair-job-card.ts` is the single source of truth. One `BlaxtairDemoJobCard`
object represents a draft, a completed submission, or a revision — the only thing that changes is
which store it lives in and its `status`/`revision` fields.

```ts
JOB_CARD_STAGES = ["job_site", "vehicle", "equipment", "connections", "photos", "notes", "review"]

BlaxtairDemoJobCard = {
  id, status: "draft" | "completed", createdAt, updatedAt, completedAt, currentStage,
  jobSite: BlaxtairJobSiteInfo,
  vehicle: BlaxtairVehicleInfo,
  installation: BlaxtairInstallationDetails,   // power/ground/ignition + mounting/routing/notes
  equipment: InstalledProductSystem | null,     // the pre-existing OCR/product-devices model
  photos: BlaxtairJobCardPhoto[],               // category-tagged gallery, separate from equipment.labelPhoto
  technicianNotes: string,
  revision: BlaxtairRevisionMeta,               // originalSubmissionId, revisionNumber, supersedes, reason, revisedBy, revisedAt, changedFields
}
```

Key design decisions carried over from the duplicate-detection work:

- **`equipment.id` (the product-devices "system" id) stays constant across a revision chain** —
  it identifies the physical installation, so the existing device-history exclusion
  (`excludeSystemId: equipment.id`) naturally allows same-chain device reuse with no extra code.
- **`jobCard.id` differs per revision record** — it identifies this specific submission/draft
  record, and is what the photo/submission reuse checks exclude via `getRevisionChainIds()`.
- "Current revision" and "current device installation" are both **derived views over an
  append-only log**, never a stored mutable flag — `getCurrentRevision()` picks the highest
  `revisionNumber` in a chain; `getCurrentInstallation()` (existing) picks the latest history
  event. Same architectural pattern, applied twice.

---

## 3. Component structure

`BlaxtairOcrDemoPanel.tsx` was split from one monolithic file into an orchestrator plus one
component per stage, all under `components/product-devices/blaxtair-demo/`:

| File | Role |
|---|---|
| `jobCardReducer.ts` | Pure reducer — one action per field group (`SET_JOB_SITE_FIELD`, `SET_VEHICLE_FIELD`, `SET_CONNECTION`, `SET_EQUIPMENT`, `ADD_PHOTO`, etc.) |
| `useJobCardWorkflow.ts` | The central hook: owns `jobCard` state, drafts, submissions, and every duplicate-check code path (`checkPhotoAndProceed`, `checkDeviceAndProceed`), plus `completeDemoSubmission()` / `startCorrectedRevision()` |
| `JobSiteSection.tsx`, `VehicleSection.tsx`, `ConnectionDetailsSection.tsx`, `NotesSection.tsx` | Straightforward controlled-field stages |
| `EquipmentSection.tsx` | The original OCR/camera/monitor UI, adapted to read/write through the reducer instead of local-only state |
| `PhotoField.tsx` | One reusable capture/upload/preview/replace/remove control; computes the fingerprint and calls back into the workflow hook |
| `PhotoGallerySection.tsx` | Lays out the fixed required categories (hiding a connection photo if that connection is marked not-applicable) plus a repeatable "additional photos" list |
| `ReviewSection.tsx` | Full read-only summary, per-section Edit jump-back, blocking-errors/warnings/optional-info breakdown (`computeJobCardValidation`, mode-aware — see §5.5) |
| `CompletedSubmissionsSection.tsx` | List + detail view of completed submissions, Current/Superseded badge, "Create Corrected Revision" |

`useJobCardWorkflow` is the only place that calls the duplicate-check functions — every section
component just calls `checkPhotoAndProceed`/`checkDeviceAndProceed` and renders whatever
block/prompt state comes back. This keeps the matching semantics identical no matter which stage
or photo field triggered the check.

---

## 4. Drafts, completed submissions, photo history, device history, revision chains

Four separate `localStorage`-backed stores, kept as distinct concepts on purpose (per the same
"don't conflate these" instruction that shaped the duplicate-detection work):

| Store | Key | What it holds | Built in |
|---|---|---|---|
| Drafts | `blaxtair-demo-drafts-v1` | Every in-progress job card, keyed by id — supports multiple simultaneous drafts | `blaxtair-draft-store.ts` |
| Completed submissions | `blaxtair-demo-submissions-v1` | Every job card that has been through "Complete Demo Submission," across all revisions | `blaxtair-submission-store.ts` |
| Photo-use registry | `blaxtair-photo-use-registry-v1` | `{fingerprint, jobCardId, category, fieldLabel, usedAt}` — one entry per photo, written on completion | `photo-dedup-registry.ts` (pre-existing, now fed from every category) |
| Device installation history | `blaxtair-device-installation-history-v1` | Append-only event log per `(partNumber, serialNumber)` | `blaxtair-install-registry.ts` (pre-existing) |

How they relate at each workflow moment:

- **While editing a draft**: every keystroke persists the active draft (`upsertDraft`). Photo/
  device checks run against: (a) the rest of the current in-memory job card, (b) every *other*
  draft (`findMatchingOtherDraft` — prompts, does not block), (c) every completed submission
  outside this job card's revision chain (`findCrossSubmissionPhotoReuse` /
  `findCrossSubmissionDeviceReuse` — blocks / asks-to-transfer).
- **On "Complete Demo Submission"**: the draft moves from the drafts store into the submissions
  store (`removeDraftFromList` + append), device installation events are appended (tagged
  `"reinstalled"` if any component confirmed a cross-form prompt), and photo-use registry entries
  are written for both gallery photos and the equipment's own `labelPhoto`.
- **On "Create Corrected Revision"**: `createCorrectedRevision()` copies the completed submission
  into a **new draft** — same `equipment.id`, same photos, new `jobCard.id`, `revisionNumber + 1`,
  `supersedes` = the original's id, `originalSubmissionId` set (or carried forward), `currentStage`
  reset to `"review"` so the technician immediately sees the copied data and can edit before
  re-completing. Because the chain's `jobCard.id`s are all excluded from the cross-submission
  checks (`getRevisionChainIds`), inherited photos and the inherited PN+SN are correctly **not**
  re-flagged as reuse when the revision is completed.
- **"Current" vs. "Superseded"**: never stored — `isSuperseded(card)` and `getCurrentRevision(chain)`
  both compute from the highest `revisionNumber` in the chain at read time.

### Matching-rule summary (unchanged from the duplicate-detection doc, now fully built)

| Scenario | Behavior |
|---|---|
| Duplicate elsewhere on the current form (any category) | Block |
| Match in a different saved draft | Prompt: continue previous / discard previous and continue here / cancel |
| Match in the linked original submission or an earlier revision in the same chain | Allow |
| Matching photo on an unrelated completed submission | Block |
| Matching (part number, serial number) from a prior, unrelated installation | Ask whether the device is being transferred/reinstalled |

---

## 5. Photo categories

`PhotoCategory` (`lib/prototype/photo-dedup-registry.ts`): `device_label`, `power_connection`,
`ground_connection`, `ignition_connection`, `device_mounting`, `camera_mounting`, `camera_view`,
`equipment_label`, `vin`, `odometer`, `vehicle_overview`, `completed_installation`, `other`.

`PhotoGallerySection.tsx`'s `FIXED_CATEGORIES` maps each to a required/optional field; power/
ground/ignition photo fields are hidden automatically when that connection is marked "Not
applicable" on the Connections stage, so the demo never forces a meaningless photo for a
connection type that doesn't exist on this installation. "Additional installation photos" is an
open-ended repeatable list (`category: "other"`).

Every field goes through the same `PhotoField` component, so the generic reuse check (§4) applies
uniformly — a power-connection photo cannot be silently reused as a ground-connection photo, an
equipment label photo, or anything else, on this form, in a draft, or on an unrelated completed
submission.

---

## 5.5 Completion validation mode (demo-only control)

Missing required fields/photos are classified by `computeJobCardValidation()`
(`lib/prototype/blaxtair-job-card.ts`) into `required` (a production form would treat as
mandatory) and `optional` (informational, never enforced). Whether a `required` gap actually
**blocks** completion is governed by a separate, explicitly demo-only toggle:
`lib/prototype/blaxtair-validation-mode.ts` (`ValidationMode = "qa_relaxed" | "technician_strict"`,
persisted to `blaxtair-demo-validation-mode-v1`).

- **QA / relaxed** (default): required gaps render as amber non-blocking warnings; "Complete Demo
  Submission" still succeeds. This is what makes repeated QA test runs practical without
  collecting every real photo.
- **Technician / strict**: the same gaps render as red blocking errors; `completeDemoSubmission()`
  refuses and returns `blockingIssues` instead of completing. Both the Review screen and a summary
  banner above the sticky footer list every blocking issue with a "Go to `<stage>`" jump button.

Required checks cover: job/site info (company, customer, technician, site name), a vehicle/asset
identifier (VIN or unit number), each applicable connection's point+description, device/monitor
mounting location, confirmed equipment, and every required photo category. Optional-only:
project/site-address/contact details, secondary vehicle fields, cable routing/mounting notes, the
equipment-label photo, and technician notes (this demo defines no required acknowledgement field
today — `computeJobCardValidation()` is the single place a production form config would add one).

The toggle is rendered in a clearly labeled, visually distinct panel in the header ("Demo-only:
completion validation mode (not a production control)") with an explicit note that production
rules come from company/project/form configuration and are server-enforced — this control must
not become a technician-facing bypass in a real build.

---

## 6. Prototype-only vs. production

| Concern | Prototype (this demo) | Production |
|---|---|---|
| Storage | Single browser's `localStorage`, four keys listed in §4 | Supabase tables (submissions, drafts, photo fingerprints, device history) — see `docs/Blaxtair_Demo_Duplicate_Detection.md` for the per-concern schema sketch |
| Photo bytes | Bounded thumbnail only (`PhotoField.buildThumbnail`, ~1200px max before thumbnailing); original file bytes are hashed for fingerprinting then discarded | Full-quality upload to Supabase Storage required, thumbnail retained only as a supplement — see the duplicate-detection doc's "Photo retention" table, same constraint applies to every category now, not just the device label |
| Cross-technician draft detection | Not simulated — single browser, single implicit "technician" | Documented only: needs a real owner/technician id column and an authorization check, not a client heuristic |
| Fingerprint algorithm | SHA-256 of exact file bytes (`crypto.subtle.digest`) | Same algorithm recommended as a first layer; does **not** catch resized/cropped/recompressed/screenshotted duplicates — perceptual hashing is a documented future enhancement, not built here |
| "Start New Demo Job" / "Discard This Draft" | Plain `window.confirm()` dialogs — fine for a single local user testing the demo | Production would use a real confirmation UI, not a blocking native dialog |
| Sample data pickers (`SampleSelect` on Job/Site) | Hardcoded fake company/project/customer names, explicitly never touching real company/customer data | Removed entirely — production reads real records from Supabase |
| Submission ID | `newId()` (client-generated UUID-ish string) | Server-generated primary key |
| "Local-only, not transmitted" banners | Shown throughout (header, completion message, Review screen) | Removed once wired to a real submission endpoint |
| Completion validation mode | Client-side toggle (§5.5), technician can freely switch between relaxed/strict | **Removed as a technician control.** Required-field/photo rules are resolved server-side from the company/project/form configuration at submission time; there is no client-side relax switch in production |

---

## 7. Manual verification performed

All of the following were exercised live in the browser, in this order, as one continuous demo
job:

1. Filled all 7 stages (Job/Site, Vehicle, Equipment via OCR sample-label scan + manual mounting/
   view, Connections with Ignition marked "Not applicable," 9 required photos, Notes) → Review
   reported no warnings.
2. Completed the submission → recorded 2 device events and 10 photos (9 gallery + 1 equipment
   label), submission appeared in Completed Demo Submissions as "Revision 1 · Current."
3. Opened the completed submission, clicked "Create Corrected Revision," supplied a reason and
   "revised by," edited the (inherited) power-connection description, completed it again with no
   duplicate warnings or blocks despite reusing the same 9 photos and the same camera/monitor PN
   +SN — confirming same-chain reuse is allowed.
4. Confirmed the submissions list now shows Revision 2 as "Current" and Revision 1 as
   "Superseded."
5. Started a brand-new demo job, entered the same camera PN+SN from step 2 — got the cross-form
   reinstall prompt ("...already installed... Is it being reinstalled on a new asset?"),
   confirmed "Yes."
6. In the same new job, uploaded a photo already used in a different, unrelated completed
   submission — got the cross-submission block ("This photo was previously submitted on another
   job card...").
7. Uploaded one fresh photo to a field, then tried to reuse it under a different category on the
   same form — got the same-form block ("This photo has already been added to this job card...").
8. Created a second draft that shared a photo with the first; verified all three draft-conflict
   outcomes: **Cancel** (dismisses, no change), **Discard previous draft and continue here**
   (removes the other draft, proceeds here), **Continue previous draft** (switches back to
   viewing/editing the other draft).
9. On a fresh, mostly-empty draft, confirmed the Review screen's "Go to `<stage>`" jump buttons
   navigate to the correct stage in both validation modes.
10. Switched to Technician / strict, clicked "Complete Demo Submission" on the incomplete draft —
    completion was refused (drafts/submissions counts unchanged), both the Review list and a
    footer summary banner listed all 19 outstanding required items with jump links, correctly
    labeled "Blocking errors."
11. Switched to QA / relaxed on the same draft, clicked "Complete Demo Submission" again — it
    succeeded this time (drafts count −1, submissions count +1) despite the identical gaps, and
    the same list was labeled "Non-blocking warnings" instead.
12. Reloaded the page and confirmed the validation-mode selection persisted (`localStorage`).

`npm run typecheck`, `npx eslint .`, `npm test` (202 tests passing), and `npm run build` were all
run clean after this phase's changes; `git diff --check` reported no whitespace/conflict issues.

---

## Related

- [Architecture.md](./Architecture.md) · [Product_Devices.md](./Product_Devices.md) ·
  [OCR_Strategy.md](./OCR_Strategy.md) · [Roadmap.md](./Roadmap.md) ·
  [Blaxtair_Demo_Duplicate_Detection.md](./Blaxtair_Demo_Duplicate_Detection.md)
