# OCR / Device Label Strategy

The OCR prototype is a **preserved asset**, not discarded work.
Integrate and promote it; **do not rewrite** without a documented deficiency.

**Git status at handoff:** branch `prototype/ocr-label-scan`, commit message `prototype: preserve device label OCR and classification`. **Not merged into `main`. Not deployed.**

---

## Current location

| Path | Role |
|------|------|
| `app/prototype/label-scan/page.tsx` | Non-production UI: capture → process → review → accept |
| `lib/prototype/label-scan/*` | Pipeline, profiles, classify, extract, OCR, preprocess, guides |
| `scripts/label-scan-fixture-eval.ts` | Fixture evaluation harness |
| `scripts/label-scan-screenshots.mjs` | Local screenshot helper |
| Dependency | `tesseract.js` (on OCR branch `package.json`) |
| Trained data | Downloaded by tesseract.js; `eng.traineddata` gitignored (do not commit) |

Route: `/prototype/label-scan`
Constraint: **no database writes**, **no Storage uploads** in the prototype UI — local processing only.

---

## Pipeline (current)

```
Capture (camera / upload)
  → crop / preprocess (orient, contrast)
  → @zxing still-image barcode/QR decode
  → if needed: Tesseract.js OCR (client WASM)
  → profile rules: aliases + regex + validators
  → classifier scores known label profiles
  → Review UI: candidates + confidence + validation
  → Accept / Edit / Retake
```

Principles already embodied:

- **Barcode-first**, OCR fallback
- Image preprocessing + orientation retry
- Hardware identity profiles
- Classifier scoring across known profiles
- Confidence bands
- **Human confirmation required**
- Identifier validation
- **No silent serial “corrections”** that invent values (suggestions may exist; accept is explicit)
- Manufacturer / rebrand independence via profiles, not company name alone

---

## Sample profiles

LinxUp-oriented profiles exist in `lib/prototype/label-scan/profile.ts` / `device-family.ts` (Asset Tracker, Vehicle Tracker, LinxCam patterns).

**Blaxtair camera profiles** are still a known need for the Tuesday demo path — extend profiles rather than inventing a second pipeline.

---

## Intended production integration (planned)

| Step | Behavior |
|------|----------|
| First successful scan | Selects / creates **Installed Product System** (product workflow) |
| Later scans | Add **components** to the active system (e.g. additional cameras) |
| Mapping | Hardware profile → company product via Product Devices resolver |
| Fallback | Manual product picker + manual identifier entry |
| Parent ownership | Photos and identifiers attach to system/component UUIDs |

Bridge types: `lib/product-devices/ocr-contract.ts` (on `main` Product Devices commit).

---

## Fixtures and ground truth

- Local fixtures under `fixtures/label-scan/` and `lib/prototype/label-scan/fixtures/` are **gitignored** (may contain real identifiers).
- Evaluation script: `scripts/label-scan-fixture-eval.ts`.
- Prefer checked-in **synthetic** fixtures for CI; keep real-device images local.

---

## Privacy and logging

- Prototype OCR runs **in the browser**; avoid uploading label images to third-party OCR SaaS by default.
- Keep OCR loggers quiet — do not log full OCR payloads or device identifiers to analytics.
- Do not commit screenshots that include live device IDs.

---

## Offline considerations

- Tesseract WASM + trained data must be cached for offline field use (PWA).
- Barcode path (`@zxing`) already aligns with existing `SerialInput` patterns.
- Plan offline trained-data hosting carefully before production promotion.

---

## Dependency status

| Item | Status |
|------|--------|
| `@zxing/browser` / `@zxing/library` | On `main` (SerialInput + prototype) |
| `tesseract.js` | On `prototype/ocr-label-scan` only |
| `eng.traineddata` | Local / downloaded; gitignored |

---

## Prototype → production checklist (high level)

1. Keep branch history; merge deliberately after Product Devices UI wiring plan.
2. Mount scan entry behind flag; never replace classic picker without fallback.
3. Wire accept → `InstalledProductSystem` / component factory.
4. Add Blaxtair AHD camera (+ monitor) profiles and fixture demos.
5. Storage path for label photos under system/component namespace.
6. Field accuracy report before removing prototype route.

## Related

- [Product_Devices.md](./Product_Devices.md) · [Roadmap.md](./Roadmap.md) · [Blaxtair_Demo_Duplicate_Detection.md](./Blaxtair_Demo_Duplicate_Detection.md) · [Blaxtair_Demo_Full_Job_Card.md](./Blaxtair_Demo_Full_Job_Card.md)
