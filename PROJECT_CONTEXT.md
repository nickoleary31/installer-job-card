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