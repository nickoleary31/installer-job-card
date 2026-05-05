# Project Context — Installer Sheetz

## How we work
- Provide clear copy/paste prompts for Cursor
- Work in small, safe steps
- Always verify before moving forward
- Avoid breaking working features
- Explicitly state when to run:
  - Supabase migrations
  - Git push
  - Local vs production testing

## Tech Stack
- Frontend: Next.js (App Router)
- Backend: Supabase (Postgres + Storage)
- Email: Resend
- Hosting: Vercel (install.tkptelematics.com)
- Dev: Cursor + VS Code
- Version control: Git
- DNS/Infra: Bluehost

## Current Architecture
- Multi-company → projects → job cards
- Drafts + submissions scoped by company/project
- Email routing:
  - installs@tkpautomotive.com (always)
  - + project external_recipient_emails
- Project-driven autofill (customer + location)

## Current Phase
- Completed: Phase 1, 2A, 2B, 2C
- Completed: Phase 2E-1 (customers table + project.customer_id)
- Next: Phase 2E-2 (backfill customers + link projects)

## Rules
- Keep changes backward-compatible
- Prefer simple solutions
- Do not introduce unnecessary complexity
## 🚀 Future Roadmap — Project Financials

### Invoicing
- Generate invoices from completed job cards within a project
- Aggregate labor, hardware, and services
- Support invoice status:
  - Draft
  - Sent
  - Paid
  - Overdue

### Expense Tracking
- Track expenses against projects
- Expense categories:
  - Labor
  - Travel
  - Parts
  - Fuel
  - Lodging
  - Misc
- Associate expenses to specific projects
- Enable basic project profit/loss visibility

### Long-Term Goal
- Full project financial dashboard:
  - Revenue (invoices)
  - Costs (expenses)
  - Profit margin

  📍 Installer Sheetz — PROJECT CONTEXT (CURRENT STATE)
🎯 Product Vision

A mobile-first job card + project management system for field technicians installing telematics and related hardware, with full lifecycle tracking:

install → submission → email → invoicing → profitability

🧱 Tech Stack
Frontend: Next.js (App Router)
Backend: Supabase (Postgres + Auth)
Email: Resend
Hosting: Local dev → future deployment
Dev Tools: Cursor + VS Code
Repo Location:
C:\dev\install-app-clean\install-app
⚙️ How We Work (VERY IMPORTANT)
Interaction style:
Small, phase-based steps
Always:
plan → implement → verify → commit → push
Avoid breaking working flows
Avoid large refactors mid-phase
Rules:
❌ Do NOT enable RLS yet
❌ Do NOT change schema unless explicitly stated
❌ Do NOT break production-capable behavior
✅ Run lint/build (or targeted lint if repo has known issues)
📊 Current Phase Status
✅ Phase 1 — Job Card Core (DONE)
Dynamic form
Photo uploads
Email sending (Resend)
Drafts
Submission history
✅ Phase 2 — Companies / Projects (DONE)
Multi-company structure
Project scoping
Customer model introduced
✅ Phase 2E — Customer Data Model (DONE)
customers table
customer_id on projects
searchable dropdown
add/edit customer UI
uniqueness constraint
customer directory UI
✅ Phase 3 — Auth + Permissions (MOSTLY COMPLETE)
Completed:
3A–3D
Supabase Auth integrated
user_profiles
company_memberships
project_assignments
login/logout UI
auth context provider
3E — Soft Permissions (COMPLETE)
✅ Company filtering
users only see assigned companies
✅ Project filtering
technicians only see assigned projects
✅ Assignment UI
admin assigns techs to projects
checkbox matrix
soft deactivate logic
✅ Assignment safety (3E-3A/B)
guards + UX polish
✅ 3E-4 — Technician Restrictions (COMPLETE)
Technician CAN:
view assigned projects
view associated customers/sites
edit:
wifi_ssid
wifi_password
Technician CANNOT:
create projects
create customers
see all customers
edit customer metadata
Admin:
full access unchanged
🧩 Current UI Improvements
✅ Project Dashboard
Added Site Info expandable card
Pulls from customer record
WiFi masked + toggle
🚨 CURRENT GAP (NEXT PRIORITY)
❌ Additional Hardware Forms (BROKEN FLOW)
Current:
VAC4 form exists
Additional hardware can be selected
BUT:
no fields render
no data can be entered
Impact:
Field techs cannot complete installs properly
🚀 NEXT PHASE
👉 Phase 4A — Additional Hardware Form Flow
Step order:
4A-1 (NEXT)
Render hardware-specific form sections dynamically
4A-2
Save + draft persistence
4A-3
Email output integration
📌 Roadmap Additions (IMPORTANT)

Future phases include:

💰 Financial System (Phase 4+)
Invoice from completed job cards
Track expenses per project
Profitability dashboard
🧠 Key Design Principles
Mobile-first UX
Technician speed > admin complexity
Progressive enhancement
UI-level permissions first → RLS later
Avoid premature backend constraints
⚠️ Known Constraints
RLS not enabled yet (intentional)
Some repo lint/build issues exist outside current scope
Working in soft-permission mode
✅ Git + Dev Environment (FIXED)
Repo restored and clean
Running locally (NOT OneDrive)
GitHub synced
No more file locking issues