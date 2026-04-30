📍 Installer Sheetz — Product Roadmap
🎯 Vision

A mobile-first job card and project management system for field technicians installing telematics and related hardware, with full lifecycle tracking from install → billing → project profitability.

✅ Phase 1 — Core Job Card System (COMPLETE)
Features
Job card form (dynamic fields)
Photo capture + upload
Email submission (Resend)
Email preview + resend
Draft save + restore
Submission history
Validation + review screen
✅ Phase 2 — Multi-Company / Project System (COMPLETE)
Phase 2A — Navigation
Company selection
Project selection
Project dashboard
Phase 2B — Data Scoping
Drafts tied to project
Submissions tied to project
Filtering per project
Phase 2C — Project Behavior
Customer + location autofill
Project-based email routing
External recipient display
Dark mode support
Phase 2D — Project UI (PARTIAL)
Project creation UI (paused)
🔄 Phase 2E — Customer Data Model (IN PROGRESS)
Goal

Move from:

Project → customer_name (text)

To:

Company → Customer → Project
Phase 2E-1 (DONE)
customers table created
projects.customer_id added
Phase 2E-2 (NEXT)
Backfill customers from existing projects
Link projects → customer_id
Phase 2E-3
Add compatibility layer:
Prefer customer table
Fallback to project fields
Phase 2E-4
Customer selection UI:
searchable dropdown
"Add new customer"
Phase 2E-5
Add new customer form:
customer info
site contact
license keys
server config
wifi info
notes
Phase 2E-6
Security hardening:
encrypt wifi_password
restrict access (admin-only later)
Phase 2E-7
Remove legacy project.customer_name dependency
🚀 Phase 3 — Authentication & Permissions
Goal

Secure the system and introduce roles

Features
User login (Supabase Auth)
Role-based access:
Admin
Technician
Admin permissions:
Create/edit projects
Create/edit customers
Manage email recipients
Technician permissions:
Create job cards
Save drafts
View assigned projects only
Security
Row Level Security (Supabase)
Protect sensitive fields (wifi, keys)
💰 Phase 4 — Financial System
Goal

Turn job cards into revenue + profitability tracking

4A — Invoicing
Generate invoice from completed job cards
Group by project
Export/send invoice
4B — Expense Tracking
Track expenses per project:
labor
materials
travel
4C — Profitability Dashboard
Revenue vs expenses
Profit per project
Cost per install
📊 Phase 5 — Reporting & Admin Tools
Submission analytics
Export data (CSV/PDF)
Project performance reports
Technician productivity tracking
🧩 Phase 6 — UX & Product Polish
Better dashboard UI
Breadcrumb navigation (Company → Project)
Improved mobile experience
Faster photo handling
Offline support (future)
📌 Backlog (Short-Term Enhancements)
Company logos
"Exit without saving" flow
Email preview improvements
Connection descriptions in submitted cards
Project context in all screens
🧠 Notes
App is already production-capable

Focus is now:

usability → scalability → monetization