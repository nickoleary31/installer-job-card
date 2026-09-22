# Installer Sheetz — RLS Hardening: Audit, Findings, Policy Matrix, Draft Migration, Test Plan

**Status: PREPARATION ONLY — revision 2 (second-engineer adversarial review).** Nothing in this
document or the companion draft SQL has been applied anywhere. No RLS was enabled, no migration
was run, no Supabase project was touched, and no application code was changed.

| | |
|---|---|
| Worktree | `C:\dev\install-app-rls` |
| Branch | `feature/rls-hardening` (base `origin/main` @ `76df9a7`) |
| Draft migration | [`supabase/rls_hardening_draft/0001_enable_rls_and_policies.sql`](../supabase/rls_hardening_draft/0001_enable_rls_and_policies.sql). It sits deliberately **outside** `supabase/migrations/` so `supabase db push` and CI can't pick it up. |
| Target when eventually applied | Installer Sheetz **V1 Dev** (`gewtjutfjrmhwmjlovly`) only |
| Never touch | Installer Sheetz **Production** (`uboutcndhvygmwfjztla`), **Developer Sheets Dev** (`ipjwhhyaurjzgaychoii`) |
| Mobile Phase 2H | `C:\dev\install-app-mobile` inspected **read-only** (`feature/mobile-shell` @ `f9f7bb3` plus uncommitted Phase 2H work, untouched) |
| Validation performed | Static only. A purpose-built linter checked token/dollar-quote balance, drop-before-create, "no raw subqueries in policies", SECURITY DEFINER `search_path`/grant hygiene, trigger attachment, and RLS coverage on all 8 tables; it passes. **The SQL has not been executed against any database** (see §11 for the V1 Dev plan). |

---

## 0. What revision 2 changed, and why

Revision 1 closed the four headline gaps on paper, but this review found that it would have shipped
with a **global-admin self-escalation still open**, plus several cross-tenant write paths. Every
change below is tied to a finding in §4.

| # | Change | Finding |
|---|---|---|
| 1 | `user_profiles`: table-level `REVOKE UPDATE` plus a column `GRANT` (revision 1's column-level revoke was a no-op), plus a guard trigger | **D1** (Critical) |
| 2 | Technician access now requires an **active company membership** as well as an active assignment (mirrors `authorizeProjectAccess`) | **D2** |
| 3 | `job_card_*` authority derived from the **project's real company**. WITH CHECK requires `company_id = project_company_id(project_id)`. Composite FK `(project_id, company_id) → projects(id, company_id)` (`NOT VALID`) also binds the **service role** | **D3**, **A2** |
| 4 | One `BEFORE INSERT OR UPDATE` expense guard: pristine review state on INSERT; non-admin updates must leave review pristine; admin reviews must be attributed to the caller; `reviewed_at`/`created_at` stamped server-side; `project_id`/`created_by`/`created_at` immutable | **D4, D5, D6, D8, D9** |
| 5 | Guard triggers are `SECURITY INVOKER` and bypass only `service_role`/`postgres`/`supabase_admin` (revision 1's `SECURITY DEFINER` + `auth.uid()` guard would also have blocked service-role and SQL-editor writes) | **D7** |
| 6 | Immutable identity columns on `company_memberships` and `project_assignments` (trigger, not column grants, because PostgREST upserts re-send key columns) | **D9** |
| 7 | `user_profiles.email` pinned to the caller's own verified login email | **D10** |
| 8 | Removed unused privileges: `projects_update`, `company_memberships_delete`, `project_assignments_delete`, global-admin client-side `user_profiles` UPDATE | **D11** |
| 9 | All raw `exists (select … from projects …)` policy subqueries replaced by SECURITY DEFINER helpers (`can_access_project(uuid)`, `can_admin_project(uuid)`, caller-scoped `project_company_id(uuid)`) | **D12** |
| 10 | Helpers use `search_path = ''`; EXECUTE revoked from `anon` explicitly (Supabase grants it directly, so revoking from PUBLIC alone leaves it) | **D13** |
| 11 | Company admins can read profiles of their **inactive** members (the assignments page needs them to reactivate users) | **D14** |
| 12 | Index `expenses (project_id, created_at desc)`; `(select …)` initPlan wrapping for per-statement constants; `TRUNCATE` revoked from API roles | **D15**, §7 |
| 13 | Read-only pre-flight diagnostics (Section 0) and a revision-1 cleanup section (Section 13) | — |

Revision 1's test-plan claim that a deactivated technician "loses access immediately" was **false**
under revision 1's SQL (D2). It is true under revision 2.

---

## 1. Current state: no RLS, app-enforced by convention

`supabase/migrations/20260425000000_v1_core_schema_baseline.sql` records the design explicitly:
*"RLS intentionally not enabled … matching this app's no-RLS, app-enforced convention."* All 8
in-scope tables (`user_profiles`, `company_memberships`, `companies`, `projects`,
`project_assignments`, `expenses`, `job_card_submissions`, `job_card_drafts`) have RLS off.

Already RLS'd and untouched: `company_form_products` (`is_global_admin()` + a membership subquery),
and `zoho_fsm_*` (zero policies + `revoke all from anon, authenticated`).

**Schema drift is confirmed, not hypothetical.** The app reads and writes `companies.active`
(`app/companies/page.tsx:123,342`), but no migration in the repo creates that column. V1 Dev must be
inspected for dashboard-created columns, views, functions, triggers and policies before applying
anything (§9 Q5–Q6).

## 2. Authorization primitives in application code

| Helper | File | Rule |
|---|---|---|
| `authorizeProjectAccess` | [`lib/project-access.ts`](../lib/project-access.ts) | global admin, OR active admin of `companyId`, OR active **technician membership** in `companyId` plus an active assignment on `projectId` |
| `authorizeCompanyUserManager` | [`lib/company-users/admin-api.ts`](../lib/company-users/admin-api.ts) | global admin OR active admin of `companyId` |
| `authorizeGlobalAdmin` | same | active global admin; requires the service-role key (fails closed) |
| `is_global_admin()` (SQL) | `20260730120000_company_form_products.sql` | `user_profiles.global_role = 'admin' AND is_active` — reused as-is |

**Defect in `authorizeProjectAccess` (finding A2):** it trusts the caller's `companyId` and
**never checks that `projectId` belongs to it** (`lib/project-access.ts:25-111`). An active admin of
company A passes with `companyId = A, projectId = <any company B project>`. The SQL helpers mirror
the *intended* rule and derive the company from the project instead.

## 3. How data is accessed

### 3a. Server routes

| Route(s) | Authorization | Data client |
|---|---|---|
| `admin/*`, `company-users/change-email`, `admin/form-products/*` | `authorizeGlobalAdmin` | service role only (fails closed) |
| `company-users/invite` | `authorizeCompanyUserManager` | service role only (fails closed) |
| `company-users/search`, `company-users/add-existing` | `authorizeCompanyUserManager` | **service role, else user-scoped fallback** |
| `expense-report` | `authorizeProjectAccess` (+ its own `.eq("company_id")`, `:82`) | **service role, else fallback** |
| `company-products` | JWT only | user-scoped by design; service role for global admins |
| `integrations/zoho-fsm/auto-publish` | `authorizeProjectAccess` | service role only (inherits **A2**) |
| `integrations/zoho-fsm/project-info`, `…/project-progress` | **authentication only, no authorization** | service role (**A3**) |
| `integrations/zoho-fsm/webhook`, `…/evidence`, `…/evidence/pdf` | shared secrets | service role |
| **`send-email`** | **none — unauthenticated** | writes `job_card_submissions` through the service role (**A1**) |
| `email-recipients` | — | no table access |
| Phase 2H (mobile): `job-card-submissions/finalize`, `…/route` (history), `…/photo-upload-url` | `authorizeProjectAccess` (inherits **A2**) | **service role, else fallback** |

### 3b. Direct browser/mobile queries (anon key + session JWT)

`lib/supabase/client.ts` is used directly by about 25 pages and components, and by `mobile-web`
(same `lib/`). With RLS off, each of these is authorized only by what the React code chooses to do.
The complete write inventory (verified by grep, §4 relies on it):

| Table | Client writes |
|---|---|
| `companies` | insert / update name / update active (`app/companies/page.tsx:263,311,342`) — UI-gated to global admin |
| `company_memberships` | insert creator-as-admin (`app/companies/page.tsx:270`); update role (`assignments/page.tsx:384-388`); update is_active (`:426-430`) |
| `project_assignments` | upsert on `(user_id,project_id)` (`assignments/page.tsx:316-325`); update is_active (`:327-331`) |
| `user_profiles` | update own onboarding fields (`app/auth/accept-invite/page.tsx:203`) |
| `projects` | insert (`app/companies/[companyId]/projects/page.tsx:683`) |
| `expenses` | insert (`projects/[projectId]/page.tsx:582`), receipt_url update (`:612`), edit (`:703-721`), delete (`:741`), review (`:760-771`); same payloads in mobile `components/ProjectDetailScreen.tsx` |
| `job_card_submissions` | select-then-insert/update by `submission_id` (`app/page.tsx:4587-4627`) |
| `job_card_drafts` | upsert on `submission_id` (`app/page.tsx:6425`); delete after submit (`:4621-4624`) |

No client code deletes from `companies`, `projects`, `user_profiles`, `company_memberships`,
`project_assignments` or `job_card_submissions`, and none updates `projects`.

## 4. Findings

Severity is for the **current production state** unless marked "(revision 1)", which means a defect
in the previous draft.

### 4a. Original four headline vulnerabilities, re-confirmed one by one

| # | Vulnerability | Re-confirmation evidence | Closed by revision 2 |
|---|---|---|---|
| **H1** | Direct `project_assignments` / `company_memberships` client writes with no server-side check. Any signed-in user can assign themselves to any project, promote themselves to company admin, or deactivate others, in any company. | `assignments/page.tsx:316-331, 384-388, 426-430`. The only gate is `canManageCompanyUsers` (`:258`), computed in the browser. | Yes: admin-only INSERT/UPDATE policies, no DELETE policy, immutable `user_id`/`company_id`/`project_id` (§6) |
| **H2** | Expense review/approve has no role check. Technicians can approve or reject any expense on a project they can reach, including their own. | `projects/[projectId]/page.tsx:755-777`, gated only by client-side `canReviewExpenses` (`:449`) | Yes: `expenses_guard_write` only lets `can_admin_project()` record a review |
| **H3** | Spoofable expense ownership/review fields: `created_by` client-supplied (`:561-567`), `reviewed_by`/`reviewed_at` client-supplied (`:764-765`), review fields settable **at INSERT** (revision 1 left this open), and ownership re-attribution/re-parenting on UPDATE | code refs as listed | Yes: `created_by = auth.uid()` WITH CHECK; pristine-on-INSERT; `reviewed_by = auth.uid()`; server-stamped `reviewed_at`/`created_at`; immutable `project_id`/`created_by` |
| **H4** | `/submitted` and `/drafts` return **every company's** rows when the localStorage selection is empty | `app/submitted/page.tsx:356-363`, `app/drafts/page.tsx:97-104`: the filter is applied only `if (selectedCompanyId && selectedProjectId)` | Yes, structurally: the SELECT policies return only rows the caller can access, whatever filter is applied. The app should still always filter (perf, §7). |

### 4b. Revision 1 draft defects (would have shipped)

| # | Sev. | Defect | Fix in revision 2 |
|---|---|---|---|
| **D1** | Critical | `revoke update (global_role, is_active) … from authenticated` is a **no-op**: `authenticated` holds table-level UPDATE through Supabase's default grants, and PostgreSQL does not reduce a table-level grant by revoking a column. With `user_profiles_update` allowing `id = auth.uid()`, any user could run `update user_profiles set global_role='admin' where id=auth.uid()` → `is_global_admin()` → full access. The handoff's "global_role escalation closed" was incorrect. | Table-level revoke + column grant + `user_profiles_guard_update` |
| **D2** | High | The technician branch was `has_active_project_assignment()` only. TS additionally requires an active technician membership (`project-access.ts:91`). Neither deactivation path (`admin/users/set-membership-active`, assignments page) deactivates assignment rows, so a **deactivated technician kept full REST access** to projects, submissions, drafts and expenses. Any user assigned by a company admin (even a non-member) also got access. | `can_access_project()` requires an active membership in the project's company |
| **D3** | High | `job_card_*` policies used `can_access_project(company_id, project_id)` on the row's **own, client-supplied** `company_id`. An admin of A could insert or update `(company_id=A, project_id=<B's project>)`, a cross-tenant write that shows up in B's project. A technician could stamp any `company_id` onto rows of their assigned project. | Authority from `projects.company_id`; consistency WITH CHECK; composite FK |
| **D4** | High | Expense guard was `BEFORE UPDATE` only → INSERT with `review_status='approved'`, `reviewed_by`, `reviewed_at` passed (handoff-confirmed) | Pristine-on-INSERT for all API callers |
| **D5** | High | Approval-then-edit: the guard fired only when review columns changed, so a creator could change `amount`/`category` on an **approved** expense and keep the approval | Non-admin updates must leave review pristine |
| **D6** | Medium (functional) | The guard rejected *any* non-admin change to review columns, but web (`:712-717`) and mobile (`ProjectDetailScreen.tsx:890-905`) edits reset review to `('pending', null, null)`. **Technicians could no longer edit any previously-reviewed expense.** | Reset-to-pristine allowed |
| **D7** | Medium (functional) | The guard was `SECURITY DEFINER` and keyed on `auth.uid()`: service-role and SQL-editor review changes (`auth.uid()` null) would be rejected, and roles could not be distinguished | Invoker triggers + trusted-role bypass |
| **D8** | Medium | Admins could attribute a review to someone else (`reviewed_by`) or backdate `reviewed_at` | `reviewed_by = auth.uid()`, `reviewed_at := now()` |
| **D9** | Medium | Ownership keys mutable on UPDATE: `company_memberships.user_id/company_id`, `project_assignments.user_id/project_id`, `expenses.project_id/created_by` | Immutability guards |
| **D10** | Medium | `user_profiles.email` was self-writable. The invite route resolves the "existing user" by `ilike('email', …)` (`invite/route.ts:85-89`), so a user who sets their email to an invitee's address can be linked into the company, possibly as admin, instead of the invitee. Search results would also show the spoofed email. | Email pinned to the caller's verified JWT email (not `user_metadata`) |
| **D11** | Low | Unused privileges: `projects_update` (a company admin could re-parent a project), hard-DELETE on memberships and assignments, global-admin client-side profile UPDATE | Removed; default deny |
| **D12** | Low | Raw `exists (select … from projects …)` subqueries in `project_assignments_*`/`expenses_*` policies worked only because `projects` RLS let the caller see the row, i.e. on the undocumented invariant *is_active_company_admin ⊆ has_active_company_membership* | SD helpers only; no policy subqueries |
| **D13** | Low | Helpers used `search_path = public` and revoked EXECUTE from PUBLIC only (anon keeps Supabase's direct grant) | `search_path = ''`, `revoke … from public, anon` |
| **D14** | Low (functional) | Company admins could not read profiles of **deactivated** members (both sides had to be active), so the assignments page showed nameless rows | `can_view_member_profile()` |
| **D15** | Low (perf) | `expenses.project_id` unindexed although every read and policy filters on it | Index added |

### 4c. Application-layer vulnerabilities RLS cannot fix (service role or no auth)

These must be fixed in code. Enabling RLS does not change them, and several get *worse* relative to
the new baseline because their "any signed-in user can already see this" justification stops being
true.

| # | Sev. | Vulnerability | Required fix |
|---|---|---|---|
| **A1** | **Critical** | **`/api/send-email` has no authentication** (`app/api/send-email/route.ts:307-326`). Anyone on the internet can (a) send mail through the app's Resend sender to recipients taken **from the request payload** (`resolveJobCardEmailRecipients` → `readProjectExternalEmails(payload)`), with attacker-controlled content and photo URLs the server then fetches; (b) overwrite the email-history columns of **any** `job_card_submissions` row by `submission_id` through the service role (`lib/email-submission-history.ts:47-50`), with a caller-chosen `last_email_sent_by` (`body.sentByUserId`, `:326`). Revision 1 classified this route as "touches none of the 8 tables", which is incorrect. | Require a bearer token. Load the submission server-side and `authorizeProjectAccess` on its stored project. Derive recipients from the stored project, not the payload. Take `sentByUserId` from the verified JWT. |
| **A2** | High | `authorizeProjectAccess` does not verify project ∈ company (§2). Exploitable through service-role consumers: **auto-publish** (a company A admin can trigger a Zoho publish for company B's project); **Phase 2H finalize** (a company A admin can write a submission into company B's project — blocked at the DB by revision 2's composite FK, but not otherwise); **history** (reads mismatched rows); **photo-upload-url**. `expense-report` is safe (it re-checks at `:82`). | In `authorizeProjectAccess`, load `projects` by id and require `project.company_id === companyId` before any branch |
| **A3** | High | Zoho `project-info` / `project-progress` authenticate but **do not authorize**: any signed-in user can read WO#/SA#/summary for any project UUID and SA counts for any company UUID. Their comments justify this by "projects/customers are readable by any signed-in user today", which is false once this migration lands. Project UUIDs are enumerable from the public `job-card-photos` bucket paths (`expenses/<projectId>/…`). | `authorizeProjectAccess` (project-info) / `authorizeCompanyUserManager`-style membership check (project-progress) |
| **A4** | Medium | Phase 2H `photo-upload-url` signs `{localSubmissionId}/{group}/{field}/{photoId}` with `upsert: true` via the service role (`local-photo.ts:153-161`, `photo-upload-url-server.ts:16-24`). The path is not bound to the authorized project or to the caller's submission, so a caller authorized on *any* project can get overwrite URLs for another tenant's photos. (The bucket's public policies have no UPDATE policy, so this service-role path is the only overwrite vector.) | Wait for Phase 2H final. Bind the path to the authorized project and verify `submission_id` is unused or belongs to it. |
| **A5** | Medium | SSRF: `expense-report` fetches every `expenses.receipt_url` server-side (`:152-156`); `receipt_url` is creator-writable | Fetch only URLs under this project's own Supabase Storage origin and `expenses/<projectId>/` prefix |
| **A6** | Medium | `company-users/search` (privileged path) lets any company admin substring-search the **whole** user directory (25 rows per query, 2-character minimum) and returns each user's memberships **in other companies**, with company names and roles | Product decision (Q7). Suggest exact-email match for company admins, and return only the target-company membership. |
| **A7** | Low | `invite` resolves users with `ilike('email', email)`; `isValidEmail` permits `%` and `_`, so wildcards can match and link an arbitrary existing profile | Escape LIKE metacharacters or use `eq` on a normalized column |
| **F-12** | Low | `expenses.needs_review` / `review_reason` (the review-queue triage flags, `page.tsx:442-446`) stay creator-controlled. The authoritative approval state is protected; the DB cannot verify receipts anyway. | Optional follow-up: derive in a trigger/generated column |

## 5. The non-service-role fallback (`createUserScopedClient`)

**Is the privileged key guaranteed in every deployed environment? No.** Evidence:

1. `getSupabaseServerEnv()` treats `SUPABASE_SERVICE_ROLE_KEY` as optional
   (`admin-api.ts:24-38`), and `authorizeProjectAccess` (`project-access.ts:61`) and
   `authorizeCompanyUserManager` (`admin-api.ts:123`) both fall back **silently** to
   `createUserScopedClient(env, accessToken)`.
2. `.env.example` does not list the key at all, and no document in the repo declares it required.
3. **Phase 2H is renaming it.** The mobile worktree's `admin-api.ts` reads
   `SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY`, but this branch reads only the legacy name.
   Any environment migrated to the new name that runs this branch's code takes the fallback without
   any error.
4. Nothing in the repo proves which Vercel/preview environments set it; this review deliberately
   did not inspect deployed configuration.

**Is the fallback reachable? Yes**, whenever (1)–(3) apply. The routes that take it:
`company-users/search`, `company-users/add-existing`, `expense-report`, and Phase 2H
`finalize` / history / `photo-upload-url`.

**What happens under RLS when it is taken:**

| Route | Behavior under revision 2 RLS | Assessment |
|---|---|---|
| requester lookups inside `authorize*` | own `user_profiles`/`company_memberships` rows are visible → authorization still correct | OK |
| `company-users/search` | **Silently incomplete**: only self and co-members; `company_memberships` only for companies the caller administers; embedded `companies(name)` only for member companies. It returns `200` with a partial list, not an error. | **Fail closed** instead |
| `company-users/add-existing` | Profile lookup (`:54-64`) is invisible for anyone not already sharing a company, so it returns **404 "User profile not found."** The membership upsert itself would pass the policy. | Feature broken; **fail closed** instead |
| `expense-report` | Correct rows; creator labels show "Unknown user" for creators who are global admins without membership, or deactivated | Acceptable, but prefer service role |
| Phase 2H `finalize` | `INSERT … ON CONFLICT DO NOTHING` needs only the INSERT policy; the read-back needs SELECT → works for legitimate callers. A `submission_id` collision with a row the caller cannot see returns **500** (read-back finds nothing) instead of **409**. | Acceptable edge case; map it (§10) |
| Phase 2H history | Correct (project-derived SELECT) | OK |
| Phase 2H `photo-upload-url` | Storage, not table RLS: `createSignedUploadUrl(…, {upsert:true})` under a user JWT hits the storage policies (no UPDATE policy on `job-card-photos`). Not verified. | Verify at 2H final |

**Recommendation: fail closed.** `search` and `add-existing` read across tenants by design and
must never run under the caller's RLS. They should return `500 missingConfigError` without the key,
exactly as `invite` already does (`invite/route.ts:42-59`). More generally, `authorizeProjectAccess`
and `authorizeCompanyUserManager` should stop handing back a silently-downgraded `dataClient`: either
require the service role, or make each route opt in to the user-scoped client explicitly. Land the
`SUPABASE_SECRET_KEY` rename in `getSupabaseServerEnv()` on `main` before or with this migration.

## 6. Final policy matrix (revision 2)

`GA` = active global admin · `CA` = active admin of the row's (project's) company · `TECH` = active
member of the project's company **and** active assignment on that project · `MEM` = any active
member of the company · `SELF` = row's own `user_id`/`id` · `SRV` = service role (bypasses RLS and
guards) · ❌ = default deny (no policy).

| Table | SELECT | INSERT | UPDATE | DELETE | Guard trigger (API roles) |
|---|---|---|---|---|---|
| `user_profiles` | SELF · GA · active co-members · CA sees all members (incl. inactive) of their companies | ❌ | SELF only; columns limited to `email, display_name, phone, job_title, onboarding_completed_at, updated_at` | ❌ | `id/global_role/is_active/created_at` immutable; `email` must equal JWT email |
| `companies` | GA · MEM | GA | GA | ❌ | — |
| `projects` | GA · MEM (all company projects, incl. unassigned — matches current UI) | GA · CA | ❌ (was anticipatory in rev 1) | ❌ | — (company re-parenting blocked by FK once it has rows) |
| `company_memberships` | SELF · GA · CA | GA · CA | GA · CA | ❌ (soft-deactivate only) | `id/user_id/company_id/created_at` immutable |
| `project_assignments` | SELF · GA · CA(project) | GA · CA(project) | GA · CA(project) | ❌ (soft-deactivate only) | `id/user_id/project_id/created_at` immutable |
| `expenses` | GA · CA · TECH | TECH/CA/GA with `created_by = self` | CA/GA (any in scope) · creator while still TECH | same as UPDATE | INSERT: pristine review, `created_at := now()`. UPDATE: `id/project_id/created_by/created_at` immutable; non-admin → review must end pristine; admin review → `approved`/`rejected`, `reviewed_by = self`, `reviewed_at := now()` |
| `job_card_submissions` | GA · CA · TECH (by project) | CA/GA/TECH **and** `company_id = project's company` | same (USING by project; CHECK adds consistency) | ❌ | — (composite FK `(project_id, company_id)` for all roles) |
| `job_card_drafts` | GA · CA · TECH (by project) | as submissions | as submissions | GA · CA · TECH | — (composite FK) |
| Storage `job-card-photos` | **unchanged**: public read + public insert, listable | | | | |
| Storage `customer-site-files` | **unchanged**: any authenticated user, unscoped | | | | |

Semantics notes:
- **UPDATE requires SELECT visibility of the new row** whenever the statement has a WHERE or
  RETURNING (every PostgREST update does). The matrix is consistent with this: no actor can update a
  row into a state they cannot read.
- **Upserts** (`project_assignments`, `job_card_drafts`, and `company_memberships` via the
  add-existing fallback) need INSERT + UPDATE + SELECT on the existing and new rows. An upsert that
  collides with a row the caller cannot update fails loudly (error), not silently.
- Drafts and submissions are **project-shared, not owner-scoped**, which matches current behavior
  (Q4).

## 7. Design notes

### 7a. Recursion / circular-policy analysis (projects, project_assignments, company_memberships, companies, user_profiles)

- Every policy calls only SECURITY DEFINER helpers plus column comparisons. The linter asserts
  there are no `select`/`from public.` subqueries in any policy body.
- Helpers are owned by the table owner, and table owners bypass RLS unless FORCE is set, so a
  helper's internal reads evaluate **no** policies. There is no path back into any policy, so there
  is no recursion, and no result depends on another table's RLS.
- Two invariants make this safe; both are checked post-apply (§11.5): helpers are owned by the
  tables' owner, and **`FORCE ROW LEVEL SECURITY` is off** on all 8 tables. With FORCE on,
  `company_memberships_select → is_active_company_admin → company_memberships RLS → …` would
  recurse.
- Pre-existing `company_form_products_select` still uses a raw subquery into `company_memberships`.
  It keeps working because `company_memberships_select` exposes the caller's own rows
  (`user_id = auth.uid()`). **Do not remove that branch.** There is no cycle
  (`company_memberships` policies never touch `company_form_products`).
- PostgREST embeds (`companies(id,name)` under memberships, `customers:customer_id(...)` under
  projects) evaluate the embedded table's own RLS. `customers` has none, so those embeds are
  unchanged.

### 7b. SECURITY DEFINER hygiene

- `set search_path = ''` and fully-qualified identifiers in all six new helpers. Existing
  `is_global_admin()` uses `search_path = public` with a fully-qualified body, which is acceptable
  and left untouched.
- Every helper answers only questions about the **caller**, so calling one directly through
  `/rest/v1/rpc/…` reveals nothing the caller could not see under RLS. `project_company_id()` is
  **caller-scoped** (it returns NULL unless the caller could read the project). An unscoped version
  would turn the RPC into a cross-tenant project→company oracle, and project UUIDs are listable from
  the public photo bucket. This is why revision 2 implements the approved `project_company_id(uuid)`
  direction in its caller-scoped form, with the authorization logic itself in
  `can_access_project(uuid)` / `can_admin_project(uuid)`.
- Guard triggers are **not** SECURITY DEFINER, on purpose (current-role detection). Caveat: a
  future SECURITY DEFINER function owned by `postgres` that writes these tables would bypass the
  guards.

### 7c. Performance / index coverage

| Predicate / helper lookup | Index used |
|---|---|
| `is_global_admin()` → `user_profiles.id` | PK |
| `is_active_company_admin` / `has_active_company_membership` → `company_memberships (company_id, user_id)` | unique `(user_id, company_id)` |
| `can_access_project` / `can_admin_project` / `project_company_id` → `projects.id` | PK |
| … then `company_memberships (company_id, user_id)` | unique `(user_id, company_id)` |
| … then `project_assignments (project_id, user_id)` | unique `(user_id, project_id)` |
| `can_view_member_profile`: mine by `user_id`, theirs by `(company_id, user_id)` | `(user_id, is_active)`; unique `(user_id, company_id)` |
| `expenses` list / policy by `project_id` | **new** `(project_id, created_at desc)` |
| `job_card_*` list by `(company_id, project_id)`; point lookups by `submission_id` | existing composite indexes; unique `submission_id` |
| Composite FK referenced key | new unique `projects (id, company_id)`; referencing side is covered by the existing `(company_id, project_id, …)` indexes |
| `company_memberships` / `project_assignments` by company / project | existing `(company_id, is_active)`, `(project_id, is_active)` |

Per-row cost for non-global-admins on `job_card_*` / `expenses` SELECT is one SD call of about 3–4
index probes. `(select public.is_global_admin())` and `(select auth.uid())` are wrapped so they run
**once per statement** (initPlan). A global admin short-circuits every per-row call. Remaining hot
spot: the **unfiltered** `/submitted` and `/drafts` queries (H4) still scan the whole table, with a
per-row policy call; the app should always filter. If `EXPLAIN ANALYZE` on V1 Dev shows a problem,
the next step is a set-returning `accessible_project_ids()` used as `project_id in (select …)`
(hashed once per statement).

## 8. Adjacent risks deliberately out of scope (ranked)

1. **`customers`, `customer_accounts`, `customer_site_files` have no RLS.** After this migration
   they are the largest cross-tenant exposure: any signed-in user can read and write every
   company's sites, including `wifi_password`, license keys and contacts. Follow-up priority 1.
2. **Storage `job-card-photos`** is public read, public insert, and listable: every photo and
   receipt, plus every submission and project id, is enumerable without authentication.
   **`customer-site-files`** is authenticated but unscoped.
3. `projects.customer_id` is not validated against the project's company (a company admin can
   link another company's site). This is harmless today only because `customers` is unprotected.
4. The "last active admin" rule stays client-only (business rule, deliberately not added).
5. Realtime and `pg_graphql`, if enabled, honor RLS. Nothing further needed.

## 9. Behavior changes and open questions

**Behavior changes that need product sign-off before apply:**

- **B1** Technicians on `/companies/[id]/assignments` see only their own row in the read-only
  matrix (they can no longer read co-workers' memberships and assignments).
- **B2** With no project selected, `app/page.tsx:2655-2688` falls back to the hard-coded
  "Powerfleet / Default Project". Non-Powerfleet users now get *"Default company not found"*, and
  Powerfleet technicians not assigned to it get an RLS error on submit or draft save. Today this is
  a silent cross-tenant write into Powerfleet's project. **Recommend requiring a project selection
  before submit.**
- **B3** The `/companies` list shows only member companies to non-global-admins.
- **B4** Expense "Added by" shows "Unknown user" for creators who are global admins without
  membership, or no longer active co-members.
- **B5** Legacy `job_card_*` rows whose `company_id` ≠ their project's company (count them with
  Section 0) become visible to the project's real company and cannot be updated through the API
  until cleaned.
- **B6** Deactivated technicians lose direct-REST access even while their assignment rows stay
  active (the TS routes already enforced this).
- **B7** Guard violations surface as PostgREST 403 (`42501`) with a descriptive message.

**Open questions:**

- **Q1** Should `user_profiles.is_active = false` revoke *all* access? Today (TS and SQL) it only
  revokes global-admin status, and no route ever sets it false.
- **Q2** Separation of duties: company admins can approve their own expenses. The app allows it;
  the draft mirrors it.
- **Q3** B1 is acceptable least-privilege, or should active co-members read the company's
  memberships and assignments?
- **Q4** Drafts and submissions are editable by every technician on the project (no owner column).
  Intended?
- **Q5** Does V1 Dev have a trigger on `auth.users` (e.g. `handle_new_user`) writing
  `public.user_profiles` **as an invoker-rights role**? If so, RLS would break it (no INSERT
  policy). Check before apply.
- **Q6** Which dashboard-created objects exist in V1 Dev but not in migrations (proven for
  `companies.active`)? Views or functions reading these tables would change behavior under RLS.
- **Q7** Is cross-tenant user search (A6) an intended company-admin capability?
- **Q8** Should the creator-controlled `needs_review` triage flag (F-12) be derived server-side?

## 10. Mobile Phase 2H compatibility (read-only review of `install-app-mobile`)

**Compatible as-is:**
- `mobile-web` uses the same `lib/` and the same anon-key client. Every policy applies
  identically.
- Mobile expense flows (`components/ProjectDetailScreen.tsx`) send **the same payloads** as web,
  including the reset-to-pending on edit (`:890-905`). This is the flow revision 1's guard would
  have broken; revision 2 allows it.
- Phase 2H does not write `job_card_*` directly. It uses `finalize`, history and
  `photo-upload-url`, all behind `authorizeProjectAccess`. Under the service role, RLS is
  irrelevant; under the fallback, revision 2 policies permit exactly the legitimate paths (§5).
- The uncommitted migration `20260921120000_job_card_submissions_technician_submit.sql` only adds
  nullable columns. Revision 2 policies are row-level and reference neither column, so there is no
  ordering dependency.
- Composite FK: finalize with a consistent `(companyId, projectId)` is unaffected. It now **stops**
  the A2 cross-tenant finalize write even through the service role.

**Must wait for Phase 2H's final commit (re-review then):**
1. **Error mapping in finalize.** Every DB error returns 500 (`finalize.ts:124,129`), and the sync
   engine treats only 401/403 as terminal (`submission-sync.ts:67`). New `42501` (RLS/guard) and
   `23503` (composite FK) rejections would **retry forever**. Map `42501` → 403,
   `23503`/`23505` → 409/422.
2. **`submission_snapshot_hash` / `technician_submitted_at` integrity.** Under the web path's
   UPDATE policy, any technician on the project can rewrite these via REST, forcing spurious 409s or
   faking "Synced" status. Decide whether a guard should make them immutable once set.
3. **A4 photo-path binding** (bind storage paths to the authorized project/submission).
4. **Env-var rename** (`SUPABASE_SECRET_KEY`) must land in `getSupabaseServerEnv()` on `main`
   together with, or before, this migration (§5).
5. Re-verify `photo-upload-url` behavior under the fallback client (storage policies).
6. Re-run §11.3 against the final 2H build.

## 11. Regression and verification plan (V1 Dev only, after approval — not run)

### 11.1 Fixtures
A global admin; Co A with an active admin, technician T1 (assigned to A1, not A2), and technician
T2 (membership **inactive**, assignment on A1 still **active**); Co B with its own admin and
technician; one expense on A1 already `approved`; one legacy mismatched `job_card_submissions` row
if Section 0 reports any.

### 11.2 Web functional (must still work)
1. Global admin: create/rename/(de)activate company (creator membership insert succeeds); see and
   manage everything.
2. Co A admin: create project; assign/unassign T1 (upsert + deactivate); change role and activate
   state; review expenses; see the inactive T2's name on the assignments page.
3. T1: read/write drafts, submissions and expenses on A1; edit a previously **approved** expense
   (must succeed and reset to pending); attach a receipt after insert; delete own expense.
4. Accept-invite onboarding self-update succeeds.
5. `/submitted` and `/drafts` with localStorage cleared: only authorized rows. Submitting with
   nothing selected shows B2's behavior.

### 11.3 Adversarial REST (as T1 via supabase-js with the anon key and T1's JWT; each must FAIL)
1. `update user_profiles set global_role='admin'` on self (D1) → permission denied.
2. `update user_profiles set email='victim@x'` on self (D10) → 42501.
3. `insert expenses (… review_status:'approved', reviewed_by:T1)` (D4) → 42501.
4. On the approved expense: `update amount` without resetting review (D5) → 42501.
5. `update expenses set review_status='approved'` (H2) → 42501.
6. `insert expenses (created_by: <other user>)` (H3) → RLS violation.
7. `update expenses set project_id=<A2>` / `created_by=<other>` → 42501.
8. `upsert project_assignments {user_id:T1, project_id:A2}` (H1) → RLS violation.
9. `update company_memberships set role='admin'` on own row → 0 rows (USING).
10. Co A admin: `insert job_card_submissions (company_id:A, project_id:<B project>)` (D3) → RLS
    violation; as service role → FK violation.
11. Co A admin: `update company_memberships set company_id=<B>` / `user_id=<X>` (D9) → 42501.
12. T2 (inactive membership, active assignment): every read and write on A1 returns empty or
    denied (D2).
13. `select * from job_card_submissions` with no filter (H4) → only A1 rows.
14. `rpc/project_company_id` with a Co B project id → `null`.
15. anon (no JWT): all 8 tables empty or denied; `rpc/is_active_company_admin` → permission denied.
16. `delete from company_memberships` / `project_assignments` / `projects` → 0 rows.

### 11.4 Android / Phase 2H (after its final commit)
Repeat 11.2 #3 and 11.3 #3–#7 on mobile; offline → online finalize for A1 succeeds; finalize for A2
or with T2 → 403 surfaces as `AuthorizationBlockedError` (no retry loop); duplicate finalize
converges (same hash → 200, different → 409); finalize with a mismatched company/project →
terminal error, not retry (§10.1).

### 11.5 Post-apply verification queries (read-only)
```sql
-- RLS on, FORCE off, owners
select c.relname, pg_get_userbyid(c.relowner) owner, c.relrowsecurity, c.relforcerowsecurity
from pg_class c where c.relnamespace = 'public'::regnamespace
  and c.relname in ('user_profiles','company_memberships','companies','projects',
                    'project_assignments','expenses','job_card_submissions','job_card_drafts');
-- helpers: SECURITY DEFINER, search_path pinned, owned by the table owner
select p.proname, pg_get_userbyid(p.proowner) owner, p.prosecdef, p.proconfig
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_global_admin','is_active_company_admin','has_active_company_membership',
                    'project_company_id','can_access_project','can_admin_project',
                    'can_view_member_profile');
-- anon cannot execute helpers
select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_exec
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'can\_%';
-- D1: authenticated must NOT be able to update global_role / is_active
select has_column_privilege('authenticated','public.user_profiles','global_role','UPDATE'),
       has_column_privilege('authenticated','public.user_profiles','is_active','UPDATE');
-- full policy list
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' order by tablename, cmd;
```

### 11.6 Storage (no policy change; confirm no regression)
Photo upload to `job-card-photos` and file upload/sign to `customer-site-files` behave exactly as
before.

---

**End of preparation deliverable (revision 2).** No SQL applied, no RLS enabled, no Supabase project
modified, no application code changed, Production and Developer Sheets Dev untouched,
`install-app-mobile` untouched.
