# Installer Sheetz — Architecture

Living document. Reflects the repository as of the handoff checkpoint after password-first onboarding was deployed and Product Devices was committed locally (not deployed).

## Status legend

| Status | Meaning |
|--------|---------|
| **Live production** | On `origin/main` and deployed to Vercel / production Supabase |
| **Committed, not deployed** | On local `main` ahead of `origin/main`, or not yet pushed |
| **Local prototype** | Preserved on a branch or untracked; not part of production UX |
| **Planned** | Documented intent; not implemented |

---

## Runtime stack (live production)

| Layer | Technology | Notes |
|-------|------------|--------|
| App | Next.js (App Router) on Vercel | Custom domain `https://install.tkptelematics.com` |
| Auth | Supabase Auth | Email/password; invite links; password-first onboarding |
| Database | Supabase Postgres | Companies, projects, customers, memberships, submissions, form products |
| Storage | Supabase Storage | Job-card photos (public bucket), customer-site-files (private Product Files / PPD JSON) |
| Email | Resend | Job-card outbound HTML + attachments; recipient resolution |

## Core product domains

### Companies, projects, customers

- Hierarchical: company → projects → customers/sites.
- Access via `user_profiles`, `company_memberships`, `project_assignments` (app-enforced; membership tables do not use RLS).

### Product catalog (live)

- **Registry** (`lib/form-registry.ts`): built-in form definitions (Powerfleet, Matrix, LinxUp, etc.).
- **DB-backed** `company_form_products`: per-company product assignment and configuration.
- **Admin UI**: `/admin/forms` (global admin).
- **Resolver**: `lib/product-config/*` merges registry + DB for the job card.

### Product Files (live)

- Canonical types in `lib/product-files/`.
- Shared PPD JSON config for exact Matrix/Powerfleet PPD product (`ppd_json_config`).
- Blaxtair and `baseFormId: "ppd"` aliases do **not** inherit the shared file by default.
- Legacy serialized keys (`artifactDefinitions`, `productArtifacts`, `artifactKey`) remain readable for compatibility.
- Storage: private `customer-site-files` bucket; signed URLs for preview; email attaches files when send succeeds.

### Auth and onboarding (live)

- Password-first invite: `/auth/accept-invite`.
- Profile fields: `phone`, `job_title`, `onboarding_completed_at` (migration `20260801130000`, already applied remotely).
- `OnboardingGate` + invite callback forwarder keep incomplete users on onboarding.
- Invite `redirectTo` resolves to trusted production origin + `/auth/accept-invite`.

### Drafts and submissions (live)

- Cloud drafts (Supabase).
- Offline IndexedDB drafts (“Saved on this device”).
- Autosave in `localStorage`.
- Submitted job cards + photos + optional Resend email.

### Photos and email (live)

- Photo upload to Storage; client/server optimization paths for email.
- Email layout models (`lib/email-layout-model.ts`, view models, recipients).
- Internal + project external recipient resolution.

---

## Product Devices / Installed Product Systems

| Aspect | Status |
|--------|--------|
| Library + types + tests | **Committed, not deployed** (`feat: add installed product systems and components`) |
| Job card UI wiring (`app/page.tsx`) | **Not wired** — pilot panel unused |
| Feature flag | `NEXT_PUBLIC_PRODUCT_DEVICES_PILOT` — default **off** |
| Email dual-read | Committed: prefers `installedProductSystems`, else legacy identifiers |

Canonical model: **Installed Product System** (company product instance) with **child components** (physical units), stable UUIDs, identifiers, variants, confirmation/override, mounting/view, label/install photo refs, system-level Product File refs separate from components. See [Product_Devices.md](./Product_Devices.md).

---

## OCR / label-scan prototype

| Aspect | Status |
|--------|--------|
| Code | **Local prototype** on branch `prototype/ocr-label-scan` |
| Route | `/prototype/label-scan` |
| Dependency | `tesseract.js` on that branch only |
| Integration into job card | **Not done** |

See [OCR_Strategy.md](./OCR_Strategy.md). Promote and integrate; do not rewrite without a documented deficiency.

---

## Feature flags

| Flag | Default | Purpose |
|------|---------|---------|
| `NEXT_PUBLIC_PRODUCT_DEVICES_PILOT` | off | Product Devices pilot (`off` \| `linxup` \| `admin` \| `linxup_admin` \| `all`) |

Unset or `off` / `false` / `0` keeps the classic product picker path.

---

## Compatibility policies

- **Product Files**: dual-read legacy artifact keys; write canonical `productFiles` / `productFileDefinitions`.
- **Product Devices**: dual-read `installedProductSystems` and legacy `installedDevices`; dual-write helpers for LinxUp identifier mirror.
- **Onboarding**: if onboarding columns missing, treat as complete (legacy installs keep working).
- **PPD**: deprecated `ppd.jsonConfigFile` / `jsonFileName` mirror retained temporarily.

---

## Production vs prototype boundaries

| Surface | Production | Prototype / local |
|---------|------------|-------------------|
| Job card `/new-submission` | Live forms, Product Files | Product Devices panel not mounted |
| `/prototype/*` | Not on production `main` deploy until OCR branch merges | OCR label-scan on `prototype/ocr-label-scan` |
| `next.config` `allowedDevOrigins` | Irrelevant outside `next dev` | Machine-specific LAN entries stay local |
| Migrations | Applied via linked Supabase; versions aligned | Filename repair committed; do not reapply |

---

## Related docs

- [UX_Standards.md](./UX_Standards.md)
- [Product_Devices.md](./Product_Devices.md)
- [OCR_Strategy.md](./OCR_Strategy.md)
- [Roadmap.md](./Roadmap.md)
- [Blaxtair_Demo_Duplicate_Detection.md](./Blaxtair_Demo_Duplicate_Detection.md)
- [Blaxtair_Demo_Full_Job_Card.md](./Blaxtair_Demo_Full_Job_Card.md)
