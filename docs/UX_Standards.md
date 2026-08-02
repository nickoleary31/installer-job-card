# Installer Sheetz — UX Standards

Living product-design standard for technician and manager surfaces.
Derived from the 2026-08 technician UX audit. Field trials still required before locking visual specs.

## Status markers

| Marker | Meaning |
|--------|---------|
| **Approved** | Adopt for upcoming UI work unless a trial disproves it |
| **Trial** | Directionally correct; validate with field technicians |
| **Future** | Depends on Product Devices, OCR, or larger IA work |

---

## Platform roles

| Principle | Status |
|-----------|--------|
| The **desktop** is optimized for **managing** work (assignments, corrections, reporting, configuration). | Approved |
| The **phone** is optimized for **doing** work (install → capture → submit). | Approved |
| **Mobile is the primary field-use target.** Desktop must not break phone usability. | Approved |
| Admin/manager capability remains reachable on mobile without overwhelming technicians. | Approved |
| Desktop may expose richer management, correction, reporting, and configuration tools. | Approved |

---

## Technician experience principles

| Principle | Status |
|-----------|--------|
| One obvious **primary action** per screen/step. | Approved |
| Completed work **collapses into summaries** (✓ name + key values + Edit). | Approved |
| Save behavior is **automatic and location-agnostic** — technicians never choose cloud vs device. | Approved |
| Every field, photo, and Product File belongs to a **clear parent** (job, vehicle, system, or component). | Approved |
| Technicians never see implementation details (Supabase, UUIDs, storage paths, form IDs). | Approved |
| The app should feel **calm** and guide the installer. | Trial |
| Prefer **icons OR words** on constrained mobile controls — both only when proven useful. | Trial |
| Sticky headers/footers must remain **compact**. | Approved |
| Do **not** force separate wizard pages; prefer a **single continuous form** with progressive disclosure and collapsible sections. | Approved |

---

## Preferred mobile footer

**Status: Approved (layout); Trial (exact labels/copy)**

```
[ Save Draft ]     [ Exit Without Saving ]
[ Review & Submit ]          ← primary
```

Rules:

- Keep the footer compact; avoid a third row of actions.
- `Review & Submit` is the primary action (filled / high emphasis).
- Do not pack three equal-weight buttons on one row on narrow phones.

---

## Save Draft behavior

**Status: Approved (behavior contract); Trial (single-control UX vs dual backends)**

| Connectivity | Behavior |
|--------------|----------|
| Online | Save to cloud **and** cache locally |
| Offline | Save locally; **automatically sync** when connectivity returns |
| UI | One **Save Draft** control — never “Save to this device” vs “Save Draft and Exit” as competing concepts |

Implementation note (current code): three mechanisms exist (cloud drafts, IndexedDB offline drafts, autosave). Phase A UX work should **unify the affordance** without requiring a storage rewrite in the first pass.

---

## Preferred install flow (IA)

**Status: Trial (structure); Future (OCR-primary entry)**

1. Job
2. Vehicle / Asset
3. Installed Systems
4. Installation Details
5. Photos & Product Files
6. Review
7. Submit

Long-term: OCR becomes the primary way to add systems; manual product picker is the fallback.
Do not claim OCR-primary until Product Devices + OCR integration ship.

---

## Navigation

| Rule | Status |
|------|--------|
| Home answers “What am I doing today?” not “Which database object?” | Trial |
| Avoid duplicating the same destinations under many labels (Drafts / Local Storage / Saved on this device). | Approved |
| Global nav on small screens should not steal primary install space (menu OK). | Trial |

---

## Membership / access UI (smallest useful)

**Status: Future / small approved improvements**

- Global Admin → Users → User Details → memberships + project assignments
- Company Admin → Team → Members → Roles
- Technician → read-only “companies/projects I’m on”

Do not redesign the organization model until typed vendor/org work is scheduled.

---

## Explicit non-goals for early UX passes

- No payload, API, or database changes required for Phase A chrome/summary/footer work.
- No Product Devices or OCR deployment as part of pure UX polish.
- No inventing final visual brand kits before field trials.

## Related

- Audit canvas: technician UX architecture (Cursor canvases)
- [Architecture.md](./Architecture.md) · [Roadmap.md](./Roadmap.md)
