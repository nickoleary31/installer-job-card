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
🔄 Phase 2E — Customer Data Model (MOSTLY COMPLETE)

Goal

Move from:
Project → customer_name (text)

To:
Company → Customer → Project

Phase 2E-1 (DONE)
- customers table created
- projects.customer_id added

Phase 2E-2 (DONE)
- Backfilled customers from existing projects
- Linked projects → customer_id
- Recovery migration implemented

Phase 2E-3 (DONE)
- Compatibility layer:
  - Prefer customer table
  - Fallback to project fields

Phase 2E-4 (DONE)
- Customer selection UI:
  - Searchable combobox (typeahead)
  - Manual entry fallback
  - "Add new customer / site" modal

Phase 2E-5 (DONE)
- Data integrity enforcement:
  - Normalized uniqueness (company_id + lower(trim(customer_name)))
  - Duplicate prevention at DB level

Phase 2E-6 (NEXT)
- Security hardening:
  - Encrypt wifi_password
  - Restrict access (admin-only)

Phase 2E-7 (FUTURE)
- Remove legacy project.customer_name dependency
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
- Generate invoices from completed job cards
- Aggregate installs per project
- Include labor, hardware, and services
- Export/send invoice
- Invoice lifecycle:
  - Draft
  - Sent
  - Paid
  - Overdue

Phase 4A-4 — Location-Based Camera Mapping
  -Goal:
- Tie camera location, serial number, and mounting photo into a single structured unit for PPD and future - - -camera-based hardware (CP4, etc.)

4B — Expense Tracking
- Track expenses per project:
  - Labor
  - Materials
  - Travel
  - Fuel
  - Lodging
  - Misc
- Associate expenses to job cards or project-level

4C — Profitability Dashboard
- Revenue vs expenses
- Profit per project
- Cost per install
- Margin tracking
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