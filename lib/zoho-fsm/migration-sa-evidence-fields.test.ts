import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

// Static check that the SA evidence-fields migration adds exactly the four passive, nullable
// columns it should — mirrors the existing convention in migration-rls.test.ts /
// migration-service-address-identity.test.ts. This repo has no live Supabase instance to run a
// real migration integration test against.
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260911100000_zoho_fsm_sa_evidence_fields.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

describe("zoho-fsm SA evidence-fields migration", () => {
  it("is a real, non-empty migration file", () => {
    assert.ok(migrationSql.trim().length > 0);
  });

  it("adds exactly the four new nullable columns to zoho_fsm_service_appointments, with no default", () => {
    assert.match(migrationSql, /add column if not exists parent_work_order_id text(?!\s+default)/i);
    assert.match(migrationSql, /add column if not exists sa_target_asset_count integer(?!\s+default)/i);
    assert.match(migrationSql, /add column if not exists sa_finalized_asset_count integer(?!\s+default)/i);
    assert.match(migrationSql, /add column if not exists zoho_sa_status text(?!\s+default)/i);
  });

  it("does not default any of the four columns to zero/empty — blank must stay distinguishable from an explicit 0", () => {
    assert.doesNotMatch(migrationSql, /sa_finalized_asset_count integer\s+default/i);
    assert.doesNotMatch(migrationSql, /sa_target_asset_count integer\s+default/i);
  });

  it("does not rename or alter the existing zoho_work_order_id column", () => {
    assert.doesNotMatch(migrationSql, /rename column zoho_work_order_id/i);
    assert.doesNotMatch(migrationSql, /alter column zoho_work_order_id/i);
  });

  it("does not create a zoho_fsm_work_orders table or add any pricing/billing-method column — out of scope for this PR", () => {
    assert.doesNotMatch(migrationSql, /create table[^;]*zoho_fsm_work_orders/is);
    assert.doesNotMatch(migrationSql, /billing_method/i);
    assert.doesNotMatch(migrationSql, /list_price/i);
  });

  it("targets only zoho_fsm_service_appointments — no other table is altered", () => {
    const alterMatches = [...migrationSql.matchAll(/alter table (?:if exists )?public\.(\w+)/gi)].map((m) => m[1]);
    assert.deepEqual(new Set(alterMatches), new Set(["zoho_fsm_service_appointments"]));
  });
});
