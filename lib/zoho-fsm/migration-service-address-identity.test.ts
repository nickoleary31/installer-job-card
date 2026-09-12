import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

// Static check that the Service_Address identity migration actually makes the schema changes
// the new model depends on. This repo has no live Supabase instance to run a real migration
// integration test against, so this asserts on the migration's SQL text — mirrors the existing
// convention in migration-rls.test.ts / v1-core-schema-baseline.test.ts.
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260909120000_zoho_fsm_service_address_identity.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

describe("zoho-fsm Service_Address identity migration", () => {
  it("is a real, non-empty migration file", () => {
    assert.ok(migrationSql.trim().length > 0);
  });

  it("adds zoho_service_address_id to customers", () => {
    assert.match(migrationSql, /add column if not exists zoho_service_address_id text/i);
  });

  it("requires customer_account_id whenever zoho_service_address_id is set", () => {
    assert.match(
      migrationSql,
      /check \(zoho_service_address_id is null or customer_account_id is not null\)/i,
    );
  });

  it("adds the composite partial unique index scoped to (customer_account_id, zoho_service_address_id) — not a bare global-unique index", () => {
    assert.match(
      migrationSql,
      /create unique index if not exists customers_customer_account_service_address_unique\s+on public\.customers \(customer_account_id, zoho_service_address_id\)\s+where customer_account_id is not null and zoho_service_address_id is not null/i,
    );
    // Never a unique index on zoho_service_address_id alone.
    assert.doesNotMatch(migrationSql, /unique index[^;]*on public\.customers \(zoho_service_address_id\)/i);
  });

  it("removes the obsolete Installer Sheetz Site Code identity model completely", () => {
    assert.match(migrationSql, /drop index if exists public\.customers_zoho_site_code_unique/i);
    assert.match(migrationSql, /drop column if exists zoho_site_code/i);
  });

  it("restricts the normalized customer_name uniqueness to manual/non-Zoho Sites only", () => {
    assert.match(migrationSql, /drop index if exists public\.idx_customers_company_normalized_customer_name;/i);
    assert.match(
      migrationSql,
      /create unique index if not exists idx_customers_company_normalized_customer_name_manual\s+on public\.customers \(company_id, lower\(trim\(customer_name\)\)\)\s+where zoho_service_address_id is null/i,
    );
  });

  it("replaces the site-code inbound-event diagnostic column with a Service Address identity column", () => {
    assert.match(migrationSql, /add column if not exists zoho_service_address_id_value text/i);
    assert.match(migrationSql, /drop column if exists zoho_site_code_value/i);
  });
});
