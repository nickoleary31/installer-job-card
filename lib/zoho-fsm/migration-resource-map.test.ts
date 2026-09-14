import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

// Static check that the zoho_resource_map migration matches the "integration state, not business
// data" convention already used by the other zoho_fsm_* adapter tables — mirrors the existing
// convention in migration-rls.test.ts / migration-sa-evidence-fields.test.ts. This repo has no
// live Supabase instance to run a real migration integration test against.
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260914000000_zoho_resource_map.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

describe("zoho_resource_map migration", () => {
  it("is a real, non-empty migration file", () => {
    assert.ok(migrationSql.trim().length > 0);
  });

  it("creates the zoho_resource_map table with the permanent-identity columns", () => {
    assert.match(migrationSql, /create table if not exists public\.zoho_resource_map/i);
    assert.match(migrationSql, /zoho_resource_id text not null/i);
    assert.match(migrationSql, /user_id uuid not null references auth\.users\(id\)/i);
    assert.match(migrationSql, /mapped_by uuid references auth\.users\(id\)/i);
  });

  it("enforces exactly one mapping per zoho_resource_id", () => {
    assert.match(migrationSql, /unique\s*\(zoho_resource_id\)/i);
  });

  it("enables RLS and revokes client access — same convention as the other zoho_fsm_* tables", () => {
    assert.match(migrationSql, /alter table public\.zoho_resource_map enable row level security/i);
    assert.match(migrationSql, /revoke all on public\.zoho_resource_map from anon, authenticated/i);
  });

  it("creates no client-facing policy for this table", () => {
    assert.doesNotMatch(migrationSql, /create policy/i);
  });

  it("targets only zoho_resource_map — no other table is created or altered", () => {
    const createMatches = [...migrationSql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(
      (m) => m[1],
    );
    assert.deepEqual(new Set(createMatches), new Set(["zoho_resource_map"]));
    assert.doesNotMatch(migrationSql, /alter table (?!public\.zoho_resource_map)/i);
  });

  it("does not implement auto-assignment, Site Lead, or removal sync — mapping foundation only", () => {
    assert.doesNotMatch(migrationSql, /project_assignments/i);
    assert.doesNotMatch(migrationSql, /is_site_lead/i);
  });
});
