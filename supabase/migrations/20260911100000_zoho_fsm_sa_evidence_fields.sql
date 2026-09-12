-- Zoho FSM integration: passive capture of the Parent Work Order relationship and the Service
-- Appointment's own Target/Finalized Asset Count + lifecycle Status onto the existing SA link
-- row. Purely additive, read-only evidence for a future external orchestrator service — under
-- the locked V1 hybrid architecture, Installer Sheetz never owns Zoho Work Order financial/
-- billing mutation logic (Parent-vs-Follow-Up rollups, batch finalization, quantity/pricing
-- writes). This migration adds nothing beyond passive storage.
--
-- The existing zoho_work_order_id column is left completely unchanged — physical rename
-- provides no operational value and adds migration risk. It is understood at the
-- application/type level as "owning Work Order id" (the Work Order directly associated with a
-- Service Appointment, normally a Follow-Up/Batch WO for deployment work) — see
-- lib/zoho-fsm/field-mapping.ts and lib/zoho-fsm/resolve.ts. The new parent_work_order_id below
-- is a distinct relationship: Zoho's own native Parent_Work_Order.id, the original commercial/
-- deployment Work Order a Follow-Up/Batch WO was created directly from. The two must never be
-- conflated.

alter table if exists public.zoho_fsm_service_appointments
  add column if not exists parent_work_order_id text,
  add column if not exists sa_target_asset_count integer,
  add column if not exists sa_finalized_asset_count integer,
  add column if not exists zoho_sa_status text;

-- All four columns are nullable with no default. This matters most for
-- sa_finalized_asset_count, where the distinction is load-bearing:
--   null = not yet finalized
--   0    = finalized with zero completed assets
-- These meanings must never collapse into each other — do not add a default value here or in
-- any downstream code that writes to this column.
