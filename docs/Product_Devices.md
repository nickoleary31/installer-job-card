# Product Devices — Installed Product Systems

Living document for the Product Devices model introduced as library + email dual-compat.

**Git status at handoff:** committed on local `main` as `feat: add installed product systems and components` — **not pushed, not deployed, job card UI not wired.**

---

## Concepts

| Term | Meaning |
|------|---------|
| **Company product** | Catalog entry assigned to a company (registry + `company_form_products`) |
| **Hardware profile** | Label/identifier expectations for a physical unit type (e.g. LinxUp AT3 label) |
| **Installed Product System** | One install instance of a company product on a vehicle/asset |
| **Component** | Physical unit inside a system (tracker, camera, monitor, …) |

Shared vehicle/asset fields stay **outside** `installedProductSystems[]`.
**Product Files** stay at **system/product** level unless explicitly component-scoped.

---

## Canonical payload shape (summary)

- `installedProductSystems: InstalledProductSystem[]`
- Each system: stable `id` (UUID), product keys, confirmation flags, optional `installationVariant`, `productFileRefs`, `components[]`
- Each component: stable `id` (UUID), `slotKey`, type/role, `identifiers`, mounting location, view direction, label/install photos, confirmation/override
- Legacy: `installedDevices[]` normalized into systems via `normalizeInstalledProductSystems`

Code: `lib/product-devices/types.ts`, `normalize.ts`, `factory.ts`, `merge.ts`.

---

## Capabilities checklist

| Capability | Supported in library |
|------------|----------------------|
| Installed Product System | Yes |
| Child components | Yes |
| Stable system UUID | Yes (`createInstalledSystemId`) |
| Stable component UUID | Yes (`createInstalledComponentId`) |
| Identifiers + validation/edits | Yes (`identifiers.ts`) |
| Installation variant (e.g. OBD-II / JBUS) | Yes |
| Technician confirmation / detection override | Yes |
| Manual fallback reason | Yes |
| Component mounting location | Yes |
| View direction | Yes |
| Label / install photo refs (namespaced by system/component UUID) | Yes (model; Storage path conventions TBD for label photos) |
| System-level Product Files separate | Yes (`productFileRefs` on system) |
| Legacy `installedDevices` normalization | Yes |
| Classic picker fallback (panel API) | Yes in pilot panel; **unwired** in `app/page.tsx` |
| Feature flag off by default | Yes (`NEXT_PUBLIC_PRODUCT_DEVICES_PILOT`) |

---

## Simple products (1 system / 1 component)

| Product | Shape | Notes |
|---------|-------|--------|
| LinxUp Asset Tracker (AT3) | 1 system / 1 component | Standard tracker component |
| LinxUp Vehicle Tracker | 1 system / 1 component | Variants: `obd_ii`, `jbus` |
| LinxCam | 1 system / 1 component | MAC + serial expectations |

Profiles: `lib/product-devices/hardware-profiles.ts`.

---

## Blaxtair AHD (multi-component fixture)

| Rule | Behavior |
|------|----------|
| System count | One Blaxtair AHD system |
| Cameras | 1–4 camera components |
| Monitor | One monitor component |
| Ownership | By component UUID + `slotKey` — **not** array index |
| Ordering | Deterministic (`slotKey`, then `id`) |
| Camera count change | Rebuild keeps identity by slot; removal does not cross-wire remaining records |

Code: `lib/product-devices/blaxtair-ahd.ts`. Opt-in fixture for demos/tests.

---

## Resolver and dual-write

- **Resolver** (`resolver.ts`): maps hardware profile / detection toward company products.
- **Dual-write** (`dual-write.ts`): mirrors into legacy LinxUp `deviceIdentifiers` for review/email while pilot is incomplete.
- **Email** (`email-sections.ts` + `lib/email-layout-model.ts`): if systems present, emit system sections; else fall back to legacy identifiers.

---

## Feature flag

`NEXT_PUBLIC_PRODUCT_DEVICES_PILOT`

| Value | Effect |
|-------|--------|
| unset / `off` / `false` / `0` | Disabled (**default**) |
| `linxup` | LinxUp company only |
| `admin` | Global admins only (caller supplies `isGlobalAdmin`) |
| `linxup_admin` | LinxUp **and** global admin |
| `all` | All companies (local testing only) |

Immediate disable: set off / unset and restart `next dev` (or redeploy env).

---

## Current limitations

1. **`app/page.tsx` does not mount** `ProductDevicesPilotPanel` — classic product selection remains the only live UI.
2. **Live OCR not integrated** — `ocr-contract.ts` is a bridge surface only.
3. **Label-photo Storage namespace** modeled in types; end-to-end Storage conventions for label photos not production-hardened.
4. **Tests** cover flag, dual-write, merge isolation; Blaxtair count/remove coverage is thinner than the library surface.
5. **Not deployed** — production users never see the pilot until UI wiring + push + deploy + flag configuration.

---

## Compatibility

- Prefer writing `installedProductSystems`.
- Continue reading `installedDevices` for older drafts.
- Do not break classic LinxUp `linxup.deviceIdentifiers` paths for legacy submissions.

## Related

- [OCR_Strategy.md](./OCR_Strategy.md) · [Architecture.md](./Architecture.md) · [Roadmap.md](./Roadmap.md) · [Blaxtair_Demo_Duplicate_Detection.md](./Blaxtair_Demo_Duplicate_Detection.md) · [Blaxtair_Demo_Full_Job_Card.md](./Blaxtair_Demo_Full_Job_Card.md)
