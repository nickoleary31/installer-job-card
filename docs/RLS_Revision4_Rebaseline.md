# Installer Sheetz — RLS Revision 4: Re-baseline, Preflight and Test Matrix

**Status: DRAFT ONLY. Nothing applied to any database.** Revision 4 re-derives the shared
Installer Sheetz (IS) RLS package from current code:

| Ref | SHA | Notes |
|---|---|---|
| `origin/main` | `5ded8e741abe196e3ce9ffaeba8c693620e363a4` | PR #28, "authorize privileged live web routes" |
| `feature/mobile-shell` | `36938d1fe391216b6bcd601a42dab4142d4b626d` | Checkpoint 1 `0c66016` + Checkpoint 2 `36938d1` |
| `feature/rls-hardening` (start) | `b635f721ed79963ab734f0d30446f69a3159ada4` | Revision 3 |

It supersedes the draft-specific parts of [`RLS_Hardening_Audit.md`](RLS_Hardening_Audit.md)
(revisions 2–3), which remains the historical record.

Draft files (all under `supabase/rls_hardening_draft/`, none executable by tooling):

| File | Purpose |
|---|---|
| `00_v1dev_preflight_readonly.sql` | **New.** Read-only target proof and state capture |
| `0001_enable_rls_and_policies.sql` | Table RLS, helpers, guards, FKs, index |
| `0002_job_card_photos_storage_policies.sql` | Storage: `job-card-photos` **and** `customer-site-files` |
| `0003_enforce_active_profiles.sql` | Q1 inactive-profile lock-out (restrictive policies) |

---

## A. Git / worktree state (read-only checks, 2026-09-25)

- Worktree `C:\dev\install-app-rls`, branch `feature/rls-hardening`, HEAD `b635f72` at start, clean.
- Upstream: `origin/feature/rls-hardening` (matches the remote SHA). `branch.feature/rls-hardening.merge
  = refs/heads/feature/rls-hardening`; no `remote.origin.push` override; `push.default` unset (Git's
  `simple`). **A plain `git push` targets `feature/rls-hardening`, not `main`.**
- `origin` = `github.com/nickoleary31/installer-job-card`.
- Relative to `origin/main`: **ahead 2 / behind 1** (behind by PR #28 only).
- Rebase/merge is **not** needed for this pass. The branch contains only docs and draft SQL, and PR
  #28 touches neither. Rebase onto `main` before any PR to `main`.

## B. Supabase CLI target — CRITICAL

`supabase/.temp/` is **committed** in this repo (on `main`, on mobile `36938d1` and here), and not
git-ignored:

- `supabase/.temp/project-ref` = **`uboutcndhvygmwfjztla` = PRODUCTION**
- `linked-project.json` → the same ref; `pooler-url` → the Production pooler (no password stored)

Anyone running `supabase db push`, `supabase migration …` or `supabase db dump` from this worktree,
or from any worktree of this repo, **targets Production**. The CLI is not on PATH here, but
`npx supabase` would work. Nothing was run. Required handling:

1. Never use the CLI link state for RLS work. Connect to V1 Dev (`gewtjutfjrmhwmjlovly`) with an
   explicit connection string and prove the target with preflight §A (below).
2. Separate fix on `main` (out of scope here): untrack `supabase/.temp/` and git-ignore it.

## C. What changed since revision 3, and the RLS impact

| Change | Where | RLS impact |
|---|---|---|
| `decideProjectAccess` / `decideCompanyAccess`: project must belong to the requested company (409); **inactive or missing profile refused for every requester**; optional `requireActiveProject` | main `lib/project-access.ts:106-236` (inactive refusal at `:144`, `:211`; identical on mobile) | Same rules as the SQL helpers, except the profile-active rule, which the SQL applies only in `0003` (gated on Q1 preflight). No helper change needed. |
| `requirePrivilegedServiceClient` (fail closed) | main `lib/company-users/admin-api.ts`; mobile also reads `SUPABASE_SECRET_KEY` | Privileged routes can't silently degrade to the user-scoped client (§M) |
| `/api/send-email` authorized: stored submission scope, project access, storage-reference validation, recipients from the DB | main PR #28 (same on mobile) | A1 fixed on main |
| Zoho `project-info` / `project-progress` authorized | main PR #28 | A3 fixed on main |
| `lib/storage-references.ts`: exact photo / product-file path families | main + mobile | **Source of truth** for `0002` (§G) |
| Native photo path gains a **verified uploader segment** | mobile `lib/local-photo.ts:169-180`, `photo-upload-url.ts:81-101` | Revision 3's `0002` predates it → rewritten |
| finalize: `requireActiveProject`, hash/timestamp/submission-id validation, payload company/project must match (409), photos must be in the requester's own namespace; 404 with a body → terminal | mobile `finalize.ts`, `submission-sync.ts:106-110` | Native storage references now owner-bound on the server |
| Native submissions bound to their project (no Default Project fallback for native) | mobile Checkpoint 1 (`resolveSubmissionContextIds`) | B2 fixed for native; web still falls back |

`project-access.ts`, send-email and the Zoho route code are **byte-identical** on main and mobile.
Only `admin-api.ts` (key rename) and three lines of `storage-references.ts` differ.

## D. Current database access surface

RLS state today = the repo migrations (confirm with preflight §B): RLS **off** on every table below
except `company_form_products` and `zoho_fsm_*`.

| Resource | Web client (main/mobile web) | Native client (mobile) | Server / service role | RLS today | Boundary (rev 4) | Should stay direct? |
|---|---|---|---|---|---|---|
| `companies` | R all; GA insert/update | R (ActiveProjects) | admin routes, Zoho | off | GA or member | yes |
| `projects` | R; CA insert | R | Zoho create/update; auth reads | off | GA or member; CA insert | yes |
| `customers` | R; CA insert (2 pages); CA update; **tech Wi-Fi update** | R (autofill, detail embed) | Zoho create/update | **off** (wifi_password exposed) | GA/CA; tech only for sites of assigned projects; tech writes Wi-Fi only | yes (consider server-side `wifi_password` later) |
| `customer_accounts` | R name | R name | Zoho writes | **off** | member read; no client writes | yes |
| `user_profiles` | R; self onboarding update | R (userContext) | invite, admin routes | off | self / co-member / CA; self limited columns | yes |
| `company_memberships` | R own + company (CA); CA update role/active; GA insert on company create | R own | invite, add-existing, set-membership-active | off | self, GA, CA | admin writes should move server-side eventually |
| `project_assignments` | R; CA upsert/deactivate | R own | project-access reads | off | self, GA, CA(project) | same |
| `job_card_submissions` | R; select-then-insert/update (web submit) | via finalize/history only | finalize, history, send-email, email history, Zoho evidence | off | by project; company consistency; snapshot freeze | web direct stays for now |
| `job_card_drafts` | R; upsert; delete after submit | (local SQLite) | Zoho evidence count | off | by project | yes |
| `customer_site_files` | R by project/customer/submission; insert | same components | Zoho evidence | **off** | by project; uploader stamped | yes |
| `expenses` | R/I/U/D, review | same (ProjectDetailScreen) | expense-report | off | **Expenses workstream** | — |
| `company_form_products` | R via `/api/company-products` (user JWT) | same | admin routes (service) | **on** (GA writes, member read) | unchanged | yes |
| `zoho_fsm_*` | none | none | webhook, evidence, auto-publish | **on**, zero policies, grants revoked | unchanged (service only) | n/a |
| Storage `job-card-photos` | upload W4 (upsert), receipts R4 (upsert), `list` (/photos), `remove` (no-op), public URLs | signed upload N7 via server, public URLs | send-email / email CID download (service) | public read+insert **to anon**, listable | §G | native already server-signed |
| Storage `customer-site-files` | upload P5/F7, `createSignedUrl` | same | email product files download (service) | authenticated **all ops**, unscoped | §G | yes, bound |

The Mobile Checkpoint 2 finding ("direct native/user-key access") is reconciled as follows. Native
photo *uploads* are server-signed only. The remaining direct user-key access from native is the
shared components: expenses/receipts, customer-site-files uploads, customer reads, provisioning
reads. All of it is covered by `0001`/`0002` above, except `expenses` (Expenses workstream).

## E. Problems found in the existing (revision 3) drafts

1. **`0002` path model obsolete.** It predates the native uploader segment, and it matched *any*
   depth with two leading UUIDs (inexact). Revision 4 matches the exact families by depth.
2. **Legacy web photos cross-tenant.** Revision 3 left `{submissionId}/…` readable (listable) by
   every signed-in user. Revision 4 binds it to the stored submission/draft's project, or to the
   object owner before the first save.
3. **`customer-site-files` untouched.** Any signed-in user could read, upload, **update and
   delete** any tenant's site files. Revision 4 binds by project and removes UPDATE/DELETE.
4. **`customers` / `customer_accounts` / `customer_site_files` had no RLS.** Cross-tenant
   `wifi_password`, license keys and contacts. Revision 4 adds them.
5. **Expenses policies/guard inside the shared package**, conflicting with the separate Expenses
   workstream. Withdrawn; contract + findings handed off (§H).
6. **Q9 not implemented.** Content was still revisable after a snapshot hash. Now frozen.
7. **`projects_insert` allowed linking another company's customer.** Now same-company only.
8. **Draft `submission_id` renamable.** Now immutable (Q11-style squatting).
9. **`0003`** covered expenses and not the customer tables; its app-side status was stale. Fixed.
10. **No target proof step**, while the repo's CLI link points at Production. `00_…` added.
11. Revision 3's audit still listed A1/A3 as open (they're fixed on main) and cited `app/page.tsx`
    locations that moved. Superseded by this document.

## F. Revision 4 changes (draft files)

- **`00_v1dev_preflight_readonly.sql` (new):** target proof, RLS/policy/function/grant/column/
  index/trigger/view/publication snapshots, storage family distribution, data-integrity counts, test
  identities. SELECTs only, run `default_transaction_read_only`.
- **`0001`:** header/scope/apply order; §0 preflight notices (customer and site-file consistency
  replace the expense counts); §1 adds `can_access_customer`, `customer_company_id`,
  `project_customer_id`; §5 `projects_insert` customer consistency; §8 expenses **withdrawn**
  (note + contract); §9 Q9 content freeze; §10 drafts identity guard; §10A `customers`; §10B
  `customer_accounts`; §10C `customer_site_files`; §11 composite FK for `customer_site_files` +
  `idx_projects_customer_id`; §12 TRUNCATE list.
- **`0002` (rewritten):** exact families N7/N6/W4/R4/P5/F7, owner-scoped pre-save web photos,
  preconditions (storage columns, bucket flags), full rollback.
- **`0003`:** restrictive policies on the customer tables; expenses removed; app-side status
  updated.

## G. Storage path families and policy design

Derived from `lib/local-photo.ts buildRemotePhotoStoragePath`, `lib/storage-references.ts
validatePhotoStoragePath/validateProductFileReference`, `NewSubmissionForm` (web upload),
`ProjectDetailScreen` (receipts), `lib/ppd-json-storage.ts`, `lib/product-files/storage.ts`
(mobile `36938d1`; the same on main except the native path).

| Id | Bucket | Path | Folders | Produced by | Read (SELECT/list/sign) | Write (INSERT) |
|---|---|---|---|---|---|---|
| **N7** | job-card-photos | `{company}/{project}/{uploaderUserId}/{submission}/{group}/{field}/{photo}.{ext}` | 6 | server-signed upload (verified uploader) | project access **and** company = project's company | **none** (server-signed only) |
| **N6** | job-card-photos | `{company}/{project}/{submission}/{group}/{field}/{photo}.{ext}` | 5 | pre-Checkpoint-2 native (no longer produced) | same as N7 | none |
| **W4** | job-card-photos | `{submissionId}/{group}/{field}/{ts}-{name}` | 3 | web direct upload, `upsert:true` | stored submission→draft project access; if neither row exists: **object owner only** | same rule |
| **R4** | job-card-photos | `expenses/{project}/{expense}/{ts}-{name}` | 3 | receipts, `upsert:true` | project access | project access |
| **P5** | customer-site-files | `customer-sites/{customer\|unassigned}/ppd-json/{project}/{file}` | 4 | PPD JSON, `upsert:false` | project access | project access **and** customer segment = project's customer (or `unassigned`) |
| **F7** | customer-site-files | `customer-sites/{customer\|unassigned}/product-files/{product}/{fileKey}/{project}/{file}` | 6 | product files, `upsert:false` | project access | same as P5 |
| other | either | anything else | — | — | denied | denied |

Properties this proves:

- **Identity:** `auth.uid()` for API callers; for W4 pre-save, the object's `owner_id`/`owner`,
  which Storage sets from the verified JWT.
- **Company scope:** N7/N6 check the company segment against `projects.company_id`.
- **Project scope:** every family is bound through `can_access_project`.
- **Uploader ownership:** N7's uploader segment is always the verified caller, because only the
  server writes it (`photo-upload-url.ts:81-101`, and finalize rejects references outside the
  requester's namespace).
- **Another technician can't overwrite or delete a native photo:** there is no direct INSERT, no
  UPDATE and no DELETE policy, and the server route issues URLs only for the caller's own segment.
- **Deterministic retry by the same technician still works:** same path, signed upsert.
- **Authorized reads still work:** project members, admins and global admins; public URLs are
  unchanged.
- **Web paths are still supported:** W4 and R4.
- UPDATE/DELETE: none in either bucket. Revision 4 **removes** `customer-site-files`' bucket-wide
  UPDATE/DELETE policies (no app code uses them). App `remove()` calls in `job-card-photos` stay
  no-ops, as today.
- **Gate Q10:** `0002` relies on Storage performing signed uploads outside `storage.objects`
  policies. It must be verified in V1 Dev (procedure at the end of `00_…`, needs approval because
  it writes a throwaway bucket).

## H. SECURITY DEFINER, ownership, grants

| Function | File | SD? | Why | search_path | anon | authenticated | Escalation analysis |
|---|---|---|---|---|---|---|---|
| `is_global_admin()` | existing (prod) | yes | reads `user_profiles` from inside policies (including `user_profiles`' own) without recursion | `public` (body qualified) | existing grant (not changed) | yes | returns the caller's own status |
| `is_active_company_admin(uuid)` | 0001 | yes | read `company_memberships` inside its own policy without recursion | `''` | **no** | yes | caller-only boolean |
| `has_active_company_membership(uuid)` | 0001 | yes | same | `''` | no | yes | caller-only |
| `project_company_id(uuid)` | 0001 | yes | read projects regardless of RLS | `''` | no | yes | **caller-scoped** (NULL unless readable): not a project→company oracle |
| `can_access_project(uuid)` | 0001 | yes | joins projects/memberships/assignments | `''` | no | yes | caller-only |
| `can_admin_project(uuid)` | 0001 | yes | same | `''` | no | yes | caller-only |
| `can_view_member_profile(uuid)` | 0001 | yes | membership self-join | `''` | no | yes | answers "may I see user X" only |
| `can_access_customer(uuid)` | 0001 | yes | customers/projects | `''` | no | yes | caller-only |
| `customer_company_id(uuid)` | 0001 | yes | customers | `''` | no | yes | caller-scoped |
| `project_customer_id(uuid)` | 0001 | yes | projects | `''` | no | yes | caller-scoped |
| `job_card_photo_submission_access(text,text)` | 0002 | yes | must see whether a submission/draft row exists, independent of RLS | `''` | no | yes | reveals "exists-but-inaccessible vs not saved" for a guessed id (ids are random UUIDs); the owner argument only ever matches the caller's own uid |
| `job_card_photo_object_access(text,text,boolean)` | 0002 | **no** (invoker) | pure path parsing + SD helpers | `''` | no | yes | booleans only |
| `customer_site_file_object_access(text,boolean)` | 0002 | no | same | `''` | no | yes | booleans only |
| `is_active_user()` | 0003 | yes | `user_profiles` | `''` | no | yes | caller-only |
| guard trigger functions (`*_guard_*`) | 0001 | **no** (must be invoker, so `current_user` is the caller) | — | `''` | not callable as RPC | — | — |

**Ownership:** every SD helper must be owned by the owner of the tables it reads (the migration
role, `postgres` in Supabase). Table owners bypass RLS, which is what prevents recursion. `FORCE ROW
LEVEL SECURITY` must stay **off** (verified post-apply; preflight §B captures it). The Supabase
dashboard/SQL editor runs as `postgres`. A future SD function owned by `postgres` that writes these
tables would bypass the guards: document any such function.

**anon:** no EXECUTE on any new helper. It has no policies, so there's nothing to evaluate, and
revoking removes the RPC surface. `is_global_admin()` keeps its existing grant (it only ever
reports the caller).

**Expenses handoff** (not implemented here). The Expenses workstream consumes `can_access_project`,
`can_admin_project`, `project_company_id` and `is_active_user`. Findings it owns:
- INSERT-time self-approval: a `BEFORE INSERT OR UPDATE` guard is required, not UPDATE-only.
- Approve-then-edit.
- `reviewed_by` spoofing.
- `created_by` / `project_id` reassignment.
- Q2: no self-review, NULL creators reviewable.
- Q8: derived `needs_review`.
- The `receipt_url` SSRF in `/api/expense-report`.
- `expenses.project_id` has no FK or index.

## I. Immutable-field decisions (API roles unless stated)

| Table | Immutable after INSERT | Notes |
|---|---|---|
| `user_profiles` | `id, global_role, is_active, created_at`; `email` only = own JWT email | table UPDATE revoked + column grant + trigger |
| `company_memberships` | `id, user_id, company_id, created_at` | role/is_active by CA/GA |
| `project_assignments` | `id, user_id, project_id, created_at` | is_active by CA/GA |
| `projects` | everything (no UPDATE policy) | Zoho service role only |
| `job_card_submissions` | `id, submission_id, company_id, project_id, created_at, technician_submitted_at, submission_snapshot_hash` for **all non-maintenance roles incl. service_role**; **Q9:** `payload, customer, unit_number` once a hash exists | web rows (hash NULL) stay revisable |
| `job_card_drafts` | `id, submission_id, created_at` | company/project may move between accessible projects (both checks + FK) |
| `customers` | `id, company_id, created_at, customer_account_id, zoho_service_address_id, end_customer_name`; technicians: everything except `wifi_ssid, wifi_password, updated_at` (whole-row jsonb compare) | Zoho linkage is service-role only |
| `customer_site_files` | everything (no UPDATE policy); `uploaded_by`/`uploaded_at` **stamped** on INSERT | |
| `customer_accounts` | no client writes | |
| composite FKs `(project_id, company_id)` | on submissions, drafts, site files, for **all roles** | `NOT VALID`, then VALIDATE |

## J. DELETE policy decisions

No DELETE policy (default deny) on `user_profiles`, `companies`, `projects`,
`company_memberships` and `project_assignments` (soft deactivate), `job_card_submissions`,
`customers`, `customer_accounts`, `customer_site_files`, and on both storage buckets.
`job_card_drafts`: DELETE for GA or anyone with project access (post-submit cleanup). Changes from
today: `customer-site-files` loses its bucket-wide DELETE/UPDATE; memberships/assignments never had
a client DELETE path.

## K. Direct REST and client-controlled claims

- Every policy keys on `auth.uid()` plus database state. **No policy reads JWT custom claims,
  `user_metadata` or `app_metadata`.** The only JWT field used is `email` (signed by Supabase Auth)
  to pin `user_profiles.email`.
- Client-supplied `company_id` / `project_id` / `customer_id` are **cross-checked**, never
  trusted: WITH CHECK consistency plus composite FKs. `uploaded_by` is stamped; `user_id` in
  memberships/assignments is admin-controlled and immutable.
- RPC: all SD helpers are revoked from `anon` and answer only about the caller; the one weak oracle
  is `job_card_photo_submission_access` (guessed-UUID existence).
- REST paths still open after revision 4: **`public.expenses`** (no RLS until the Expenses
  workstream), and W4 pre-save photos of the caller's *own* uploads (by design).

## L. Index findings

The existing indexes cover the helper probes: `company_memberships` unique `(user_id, company_id)`,
`(user_id, is_active)` and `(company_id, is_active)`; `project_assignments` unique
`(user_id, project_id)` and `(project_id, is_active)`; projects PK; `user_profiles` PK;
`submission_id` unique on submissions and drafts; `customer_site_files (project_id, …)` and
`(customer_id, …)`; `customer_accounts (company_id)`; `customers (company_id, customer_name)`.
**Added:** `idx_projects_customer_id` (partial) for `can_access_customer`, and the unique
`projects (id, company_id)` behind the composite FKs. Removed from the shared package:
`idx_expenses_project_created_at` (Expenses workstream). Perf note: unfiltered `/submitted` and
`/drafts` queries still scan; fine at current volumes, measure with `EXPLAIN ANALYZE` on V1 Dev.

## M. Service-role routes

| Route | Main today (`5ded8e7`) | Mobile future (`36938d1`) |
|---|---|---|
| `POST /api/send-email` | **Adequate**: fail-closed gate, bearer, stored submission scope, project access, storage refs, DB recipients, verified sender | same |
| `GET zoho-fsm/project-info` | **Adequate**: project company derived server-side + project access | same |
| `GET zoho-fsm/project-progress` | **Adequate**: company access; technician sees assigned projects only | same |
| `POST zoho-fsm/auto-publish` | **Adequate**: fail-closed, `authorizeProjectAccess` (binding + inactive) | same |
| `zoho-fsm/webhook`, `evidence`, `evidence/pdf` | Intentional RLS bypass, shared-secret server-to-server | same |
| `POST /api/expense-report` | Authorized (binding + inactive), but **silent user-scoped fallback** if the key is missing; receipt SSRF | same (Expenses workstream) |
| `company-users/search`, `add-existing` | **Needs app hardening (Q7)**: silent fallback; search returns every company's memberships; `authorizeCompanyUserManager` doesn't refuse an inactive company admin | same |
| `company-users/invite` | Fail-closed; inactive-CA gap; `ilike` wildcard (A7) | same |
| `company-users/change-email`, `admin/*` | Adequate (`authorizeGlobalAdmin`, active GA) | same |
| `company-products` | User JWT (RLS) + GA service fallback: adequate | same |
| `POST job-card-submissions/finalize` | n/a (not on main) | **Adequate**: fail-closed, `requireActiveProject`, binding, storage refs owner-bound. DB errors still → 500 retryable |
| `POST job-card-submissions/photo-upload-url` | n/a | **Adequate**: fail-closed, `requireActiveProject`, uploader from the verified token |
| `GET /api/job-card-submissions` (history) | n/a | **Adequate**: fail-closed + project access (completed projects readable) |

Key env: main reads only `SUPABASE_SERVICE_ROLE_KEY`; mobile reads `SUPABASE_SECRET_KEY` first.
Neither is listed in `.env.example`. The fallback **is reachable** on main and mobile for
expense-report, search and add-existing.

## N. Prior unresolved audit questions

- **A — `project_company_id` refactor:** it changes **outcomes**, not only robustness. Authority
  now comes from `projects.company_id` instead of a row's client-supplied `company_id` (fixes D3);
  a caller-scoped form avoids an RPC oracle. **Included** (since revision 2).
- **B — Expenses self-approval:** a real finding (INSERT path needs guarding), but it **belongs to
  the Expenses workstream**. Withdrawn from the shared package and handed off (§H). Expenses drafts
  untouched.
- **C — Service-role environment:** not guaranteed (§M). Fail-closed where it matters for writes;
  the silent fallback remains on expense-report, search and add-existing. Under revision 4 RLS:
  search degrades silently, add-existing returns 404, expense-report loses some creator labels.
  **App fix required (Q7)**; not an RLS defect.
- **D — SECURITY DEFINER:** §H. All pinned `search_path = ''` (except the pre-existing
  `is_global_admin`, qualified), owner = table owner, `anon` revoked, `authenticated` granted,
  caller-only answers. None is an escalation primitive.
- **E — Immutable fields:** §I.
- **F — DELETE:** §J.
- **G — Direct REST:** §K, and the matrix §P.
- **H — Client claims:** §K. None used.
- **I — Indexes:** §L.
- **J — Empty-selection lists:** safe. The SELECT policies authorize each row by its project
  whatever the client filter (or its absence); only authorized rows return. The performance cost
  remains (app should always filter).

## O. V1 Dev preflight checklist (must all pass before approving `0001` for V1 Dev)

Run `00_v1dev_preflight_readonly.sql` in one read-only session and keep the output.

1. **Target proof.** The operator confirms the connection string contains `gewtjutfjrmhwmjlovly`.
   §A shows migration `20260921120000` present and both Phase 2H columns. **Any mismatch → stop**
   (Production has neither).
2. **Capture state** (§B–§D): RLS flags (all off except `company_form_products`/`zoho_fsm_*`;
   FORCE off everywhere), all `public`+`storage` policies, all `public` functions with owner/SD/
   config/EXECUTE, table and column grants. This is the rollback reference.
3. **Schema** (§E): every referenced column `present = true`, including `storage.objects.owner`
   and `owner_id`. Review drifted columns.
4. **Indexes** (§F): the ones listed in §L exist.
5. **Triggers** (§G / Q5): no invoker-rights trigger on `auth.users` writing `user_profiles`;
   list every trigger on in-scope tables.
6. **Dashboard objects** (§H / Q6): no views over in-scope tables that would change meaning; review
   the realtime publication.
7. **Storage** (§I): bucket flags (`job-card-photos` public, `customer-site-files` private); family
   distribution; review every "other" object, and W4 objects without a row or owner.
8. **Data** (§J): all consistency counts reviewed. Zero required before VALIDATE; `0003` blocks on
   profile-less members/assignees.
9. **Test identities** (§K): one each of GA, CA-A, TECH-A1 (assigned to A1), TECH-A-unassigned,
   member of company B, inactive user. Create any that are missing only with approval.
10. **Service-role behavior:** confirm the V1 Dev deployment used for regression has a service key
    (secret or legacy) configured. Record it as a yes/no only; never expose the value.
11. **Baseline direct REST:** with approval, run §P's REST cases as each identity **before**
    applying, to record today's behavior.
12. **Q10 procedure** (before `0002`, needs approval): throwaway private bucket, signed upload with
    the anon key; success = policy-independent.
13. **Rollback prepared:** `0001` — disable RLS on the 10 tables, drop the 7 `trg_*_guard_*` triggers, re-grant
    `update on user_profiles to authenticated`, drop helpers; `0002`/`0003` — their rollback blocks.
    Compare against the §B snapshot before restoring.

## P. RLS test matrix

Identities: **GA** global admin · **CA** active admin of company A · **T1** technician of A
assigned to project A1 · **T0** technician of A not assigned to A1 · **B** active member of company
B · **IN** a user with an inactive profile (still holding an A membership and valid session;
expectations marked "(0003)" apply after `0003`, otherwise IN behaves as their membership) ·
**AN** anonymous (anon key only). ✓ allowed, ✗ denied/empty.

| Resource / operation | GA | CA | T1 | T0 | B | IN (0003) | AN |
|---|---|---|---|---|---|---|---|
| companies: read A | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| companies: insert / update | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| projects: read A1 / A2 | ✓ | ✓ | ✓/✓ (all A projects) | ✓/✓ | ✗ | ✗ | ✗ |
| projects: insert in A | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| projects: insert in A linked to B's customer | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| projects: update / delete | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| memberships: read A rows | ✓ | ✓ | own only | own only | ✗ | ✗ (0003; own only before) | ✗ |
| memberships: insert/update in A | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| memberships: change `company_id`/`user_id` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| memberships: delete | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| assignments: read A1 | ✓ | ✓ | own | ✗ | ✗ | ✗ | ✗ |
| assignments: upsert self onto A1 | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| submissions: read A1 | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| submissions: insert A1 with `company_id=A` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| submissions: insert A1 with `company_id=B` (forged) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| submissions: set hash / `technician_submitted_at` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| submissions: edit payload of web row / native row | ✓/✗ | ✓/✗ | ✓/✗ | ✗ | ✗ | ✗ | ✗ |
| submissions: unfiltered `select *` | all | A only | A1 only | none | B only | none | none |
| drafts: read/write/delete A1 | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| drafts: rename `submission_id` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| customers: read site of A1 / other A site | ✓/✓ | ✓/✓ | ✓/✗ | ✗/✗ | ✗ | ✗ | ✗ |
| customers: insert in A | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| customers: update name of A1 site | ✓ | ✓ | ✗ (guard) | ✗ | ✗ | ✗ | ✗ |
| customers: update Wi-Fi of A1 site | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| customers: set Zoho linkage / `company_id` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| customer_accounts: read A / write | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✗ | ✗ | ✗ |
| customer_site_files: read A1 rows | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| customer_site_files: insert A1 (`uploaded_by` forged) | ✓ stamped | ✓ stamped | ✓ stamped | ✗ | ✗ | ✗ | ✗ |
| user_profiles: read an active company-A member's profile | ✓ | ✓ (also inactive A members) | ✓ | ✓ | ✗ | own row only (0003) | ✗ |
| user_profiles: self `global_role='admin'` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| user_profiles: self email ≠ login email | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| photos N7 A1: list/read | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ (public URL still works) |
| photos N7: direct upload/overwrite (own or other's segment) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| photos N7: signed upload via server for own segment / retry | ✓ | ✓ | ✓ | ✗ (403) | ✗ | ✗ (403, app check since PR #28) | ✗ |
| photos N7 path with forged company (`{B}/{A1}/…`) read | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| photos W4 saved A1 submission: list/upload | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| photos W4 not-yet-saved: uploader / others | own ✓ | own ✓ | own ✓ / others ✗ | same | same | ✗ | ✗ |
| receipts R4 A1: read/upload | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| any photo update/delete via API | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| customer-site-files P5/F7 A1: sign/read | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| customer-site-files: upload with wrong customer segment | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| customer-site-files: update/delete | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| zoho_fsm_* via REST | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| helper RPC (`can_access_project` …) | own answer | own | own | own | own | own | ✗ (no EXECUTE) |
| expenses (any) | **unchanged: no RLS (Expenses workstream)** | | | | | | |

Native-specific cases (run on device against V1 Dev):
- Same technician retries an identical photo upload → ✓ (same N7 path, signed upsert), one object.
- T0 requests a signed URL for A1 → 403 → `authorization-blocked`. A forged `companyId=B` with
  `projectId=A1` → 409 → terminal.
- T1 finalizes a payload that references T0's N7 path → 400 terminal (storage-references).
- A different technician on A1 can view T1's photos (project-shared) but can't obtain a URL for
  T1's uploader segment.
- Forged `created_by` on an expense: **not covered** (Expenses workstream).
- Direct REST `job_card_drafts`/`job_card_submissions` for A2 as T1 → empty/denied.

## Q. Final adversarial review of revision 4

1. **Anonymous:** no policies for anon; helper EXECUTE revoked; storage API listing/upload removed
   (public URLs of `job-card-photos` still readable by URL, as today). **Holds**, except `expenses`.
2. **Other-company user (B):** every table and bucket is bound through the project→company
   helpers; forged ids fail consistency checks or FKs. **Holds** (except `expenses`).
3. **Unassigned technician (T0):** sees company metadata (companies, projects, accounts: by
   design) but no submissions, drafts, site files, sites or photos of A1. **Holds.**
4. **Forged `company_id`:** WITH CHECK `company_id = project_company_id(project_id)` plus composite
   FKs (all roles). **Holds.**
5. **Forged `project_id`:** `can_access_project` on the new row; storage re-checks the path's
   project. **Holds.**
6. **Changing `created_by`/`user_id`:** memberships/assignments immutable; `uploaded_by` stamped;
   the profile id is immutable. Expenses' `created_by` is **not covered** (Expenses workstream).
7. **Reading another technician's data:** Q4 makes drafts/submissions project-shared (accepted).
   Nothing crosses projects. **Holds by decision.**
8. **Overwriting another technician's photo:** no direct write to N7/N6, no UPDATE/DELETE policy,
   and the server route binds the uploader segment to the verified caller. **Holds** (subject to
   Q10).
9. **Legacy web paths:** saved submissions bound to the project; pre-save objects owner-only; no
   overwrite of existing objects. Residual: someone who knows a victim's *future* random submission
   id could pre-plant an object. Infeasible with `randomUUID`. **Holds.**
10. **Inactive user with a valid session:** server routes refuse (PR #28, all project-scoped
    routes; company-users routes still open). The DB refuses after `0003` (gated on preflight).
    **Holds after `0003` plus the `authorizeCompanyUserManager` fix.**
11. **Direct REST:** §K. **Holds** except `expenses`.
12. **Helper RPC:** caller-only answers, anon revoked, no oracle beyond guessed-UUID existence.
    **Holds.**
13. **Malicious request to a service-role route:** send-email, Zoho, finalize, photo and history
    are authorized in code. search/add-existing still fall back silently and over-share (Q7, app
    fix); expense-report fallback (Expenses). **Not an RLS defect; open app items.**
14. **GA workflow:** everything via policies or service routes. Profile edits of others go through
    service routes (self-only client UPDATE by design). **Works.**
15. **CA workflow:** projects, sites, memberships, assignments, submissions/drafts, site files and
    photos of own company; user search via server route. **Works** (search depends on the Q7 fix
    when no service key).

**Conclusion:** no unresolved privilege escalation or cross-tenant path remains **inside the shared
IS scope of revision 4**. The two remaining cross-tenant exposures are outside that scope by
instruction or need app code: `public.expenses` (Expenses workstream), and the company-users routes'
over-sharing (Q7).

## R. Remaining unresolved issues

1. **`public.expenses` has no RLS**: owned by the Expenses workstream. It must land before (or
   with) any Production rollout.
2. **Q10** unverified: `0002` is gated on it.
3. **Supabase CLI link → Production** committed in the repo (§B): fix on `main` separately.
4. **App-side, both branches:**
   - Q7 (search/add-existing fail-closed, minimal fields).
   - `authorizeCompanyUserManager` doesn't refuse inactive company admins.
   - B2 (web Default Project fallback).
   - Q9 amendment path: until it exists, web edits of native submissions are rejected by design.
   - finalize DB errors → 500 retryable.
   - A7 invite `ilike`.
5. Q11 residual (terminal 409 on `submission_id` squatting): accepted.
6. W4 objects with no row are owner-only. Legacy objects with no `owner` (if any; preflight §I)
   become API-invisible (public URLs still work).
7. RLS applies no inactive-*project* rule (mirrors main; mobile enforces `requireActiveProject` in
   server routes for new work).
8. `0003` needs data repair first (preflight §J).
9. Branch is 1 commit behind `main` (PR #28): rebase before any PR.
