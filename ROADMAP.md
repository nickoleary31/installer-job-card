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
Project → customer\_name (text)

To:
Company → Customer → Project

Phase 2E-1 (DONE)

* customers table created
* projects.customer\_id added

Phase 2E-2 (DONE)

* Backfilled customers from existing projects
* Linked projects → customer\_id
* Recovery migration implemented

Phase 2E-3 (DONE)

* Compatibility layer:

  * Prefer customer table
  * Fallback to project fields

Phase 2E-4 (DONE)

* Customer selection UI:

  * Searchable combobox (typeahead)
  * Manual entry fallback
  * "Add new customer / site" modal

Phase 2E-5 (DONE)

* Data integrity enforcement:

  * Normalized uniqueness (company\_id + lower(trim(customer\_name)))
  * Duplicate prevention at DB level

Phase 2E-6 (NEXT)

* Security hardening:

  * Encrypt wifi\_password
  * Restrict access (admin-only)

Phase 2E-7 (FUTURE)

* Remove legacy project.customer\_name dependency
🚀 Phase 3 — Authentication \& Permissions
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

* Generate invoices from completed job cards
* Aggregate installs per project
* Include labor, hardware, and services
* Export/send invoice
* Invoice lifecycle:

  * Draft
  * Sent
  * Paid
  * Overdue



Phase 4A-4 — Location-Based Camera Mapping
-Goal:

* Tie camera location, serial number, and mounting photo into a single structured unit for PPD and future - - -camera-based hardware (CP4, etc.)



Future Phase 4B — Site Configuration File Repository



Add a project/site-based repository for install configuration files such as PPD JSON files, camera configuration exports, FTxw setup files, and other hardware config documents.



Files should be accessible by:

\- Admin

\- Assigned technician

\- PM via secure link

\- End user via secure link



Repository should support upload, download/view, file notes, uploaded-by tracking, and association with company/project/site/hardware type.

&#x09;Phase 4B-1 — File repository UI

\- Add “Configuration Files” card to project/site dashboard

\- Upload files

\- List uploaded files

\- Show filename, upload date, uploaded by, notes



Phase 4B-2 — Supabase Storage integration

\- Store files by company/project/site

\- Example path:

&#x20; companyId/projectId/config-files/filename



Phase 4B-3 — Sharing links

\- Generate secure share links

\- Link can be sent to PM/end user

\- Optional expiration later



Phase 4B-4 — Permissions

\- Admin can see all

\- Assigned tech can see assigned project files

\- PM/end user link is read-only



Phase 4B-5 — Tie files to hardware/install

\- Link JSON/config files to PPD, CP4, FTxw, etc.

4C — Expense Tracking

* Track expenses per project:

  * Labor
  * Materials
  * Travel
  * Fuel
  * Lodging
  * Misc
* Associate expenses to job cards or project-level



4D — Profitability Dashboard

* Revenue vs expenses
* Profit per project
* Cost per install
* Margin tracking
📊 Phase 5 — Reporting \& Admin Tools
Submission analytics
Export data (CSV/PDF)
Project performance reports
Technician productivity tracking
🧩 Phase 6 — UX \& Product Polish
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



Phase 5A-2 — Expense Flags / Review Rules



Goal:

Automatically flag expenses that need review.



Flag rules:

1\. Lost receipt

\- If lost\_receipt = true → flag expense



2\. Category limit exceeded

\- Each category can have a configurable review limit

\- If amount > category\_limit → flag expense



Suggested default limits:

\- Travel - Fuel: $100

\- Travel - Car Rental: $500

\- Travel - Lodging: $250/night

\- Travel - Meals: $75

\- Parts / Hardware: $250

\- Shipping / Freight: $150

\- Tools: $100

\- Consumables: $75

\- Subcontractor: $500

\- Misc: $50



Expense fields:

\- needs\_review boolean

\- review\_reason text

\- reviewed\_at timestamp nullable

\- reviewed\_by uuid nullable

\- review\_status text: pending / approved / rejected



Admin UI:

\- Show flagged expenses at top

\- Badge: Lost receipt / Over limit

\- Allow admin to mark reviewed/approved/rejected

Focus is now:

usability → scalability → monetization

Phase 7 — SaaS / Multi-Client Foundation

* tenant-safe company model
* subscription status per company
* billing status controls access
* admin separation: platform admin vs company admin
* prepare for RLS

Phase 8 — Dynamic Form Builder

* form\_templates
* form\_fields
* form\_submissions
* conditional fields
* photo requirements
* reusable field groups

Phase 9 — Subscription Billing

* Stripe subscriptions
* company plan limits
* active/inactive billing status

