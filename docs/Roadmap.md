# Installer Sheetz — Roadmap

Living roadmap with explicit status. Do not claim deploy when only local.

---

## LIVE (production)

| Item | Notes |
|------|--------|
| Vercel hosting + custom domain | `install.tkptelematics.com` |
| Supabase Auth / Postgres / Storage | Linked project |
| Password-first invite onboarding | Deployed with `feat: add password-first invite onboarding` |
| Product Admin / DB-backed catalog | `company_form_products`, Blaxtair pilot config |
| Product Files | Shared PPD JSON for Matrix/Powerfleet; Blaxtair excluded by default |
| Draft / photo / email hardening | Cloud + offline drafts, Resend, recipient transparency |

---

## COMMITTED / NOT DEPLOYED

| Item | Location | Notes |
|------|----------|--------|
| Product Devices system/component model | Local `main` ahead of `origin/main` | Library + email dual-compat + unused pilot panel; **`app/page.tsx` not wired**; flag default off |
| Migration filename align `20260429000000` | Local `main` | Filename-only; remote already aligned; do not reapply |
| Local gitignore hygiene | Local `main` | Ignores tmp screenshots + `eng.traineddata` |

---

## LOCAL PROTOTYPE

| Item | Location | Notes |
|------|----------|--------|
| OCR / device-label classification | Branch `prototype/ocr-label-scan` | Preserve and integrate; not on `main` |
| Blaxtair AHD fixture/demo helpers | In Product Devices library | Opt-in; UI unwired |
| LAN `allowedDevOrigins` | Dirty local `next.config.ts` | Keep machine-specific; do not commit IPs |

---

## NEAR TERM

| Item | Intent |
|------|--------|
| Tuesday Blaxtair OCR demo | Scan-first local demo; no production deploy required for the demo itself |
| Live OCR integration | Prototype → Product Devices accept path |
| Identifier fields in install UI | Bound to system/component |
| Multi-camera / monitor workflow | Blaxtair AHD |
| UX field trials | Per [UX_Standards.md](./UX_Standards.md) |
| Compact action bar | Save / Exit + primary Review & Submit |
| Unified Save Draft affordance | Hide storage destination from techs |
| Collapsible completed sections | Summary cards |
| Navigation cleanup | Reduce Drafts / Local / Saved duplication |
| Membership / project-assignment visibility | Admin User Details + Team + tech “My access” |

---

## FUTURE

| Item | Notes |
|------|--------|
| Hardware identity profile admin | Manage OCR/hardware profiles without code deploys |
| Client-facing workflow questionnaire | See below |
| Drag/drop form builder | Configuration UX |
| Configuration repository access | Broader Product Files / config sharing |
| Typed organization / vendor model | Track B — paused historically; do not invent schema now |
| VIN / plate assistance | Capture aids |
| Workflow templates | Per company/product |
| Reporting / analytics | Manager desktop |

---

## Planned workflow-discovery questionnaire (2–5 minutes)

**Status: Future / discovery**

Purpose: learn how a new customer’s install workflow actually runs before configuring products.

Suggested prompts (draft):

1. What assets do you install on? (vehicles, trailers, equipment, mixed)
2. Which product families are in scope for this company?
3. Typical devices per asset (one tracker vs multi-camera systems)?
4. Who receives completion emails (internal only vs customer)?
5. Do technicians work offline often?
6. Any required config files (e.g. PPD JSON) per unit?
7. Photo standards or mandatory shots?
8. Who manages company users / project assignments?

Outputs feed: product assignments, Product Files requirements, email defaults, offline expectations — **not** automatic schema changes.

---

## Subscription / packaging recommendations (draft)

**Status: Future — inferred, not implemented**

| Tier idea | Include |
|-----------|---------|
| Core field | Job cards, drafts, photos, basic companies/projects |
| Install intelligence | Product Devices + OCR label assist |
| Config & compliance | Product Files repository, audit-friendly email |
| Admin scale | Form admin, global users, multi-company ops |

Do not hard-code pricing or entitlements in the app until product decides.

---

## Recommended first task for the next coding assistant

> Review `/docs/**` and the preserved OCR prototype on `prototype/ocr-label-scan`, then integrate **one local Blaxtair AHD scan-first demonstration** without deployment.

Constraints for that task:

- Do not push or deploy.
- Do not apply migrations.
- Do not mix unrelated UX refactors into the demo.
- Prefer extending the existing OCR prototype + Product Devices fixture over rewriting either.

---

## Related

- [Architecture.md](./Architecture.md)
- [UX_Standards.md](./UX_Standards.md)
- [Product_Devices.md](./Product_Devices.md)
- [OCR_Strategy.md](./OCR_Strategy.md)
