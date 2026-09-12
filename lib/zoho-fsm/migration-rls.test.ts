import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

// Static check that the Phase 1 migration actually locks down the Zoho-only integration
// tables the same way as the rest of the app's server-only tables. This repo has no live
// Supabase instance to run a real RLS integration test against, so this asserts on the
// migration's SQL text — it catches "forgot to add the RLS/revoke lines" regressions, though
// it cannot substitute for a real anon-client access test against a live database.
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260908000000_zoho_fsm_phase1_foundation.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

const PROTECTED_TABLES = [
  "zoho_fsm_installer_company_map",
  "zoho_fsm_service_appointments",
  "zoho_fsm_inbound_events",
];

describe("zoho-fsm Phase 1 migration — access control", () => {
  for (const table of PROTECTED_TABLES) {
    it(`enables RLS and revokes anon/authenticated grants on ${table}`, () => {
      assert.match(
        migrationSql,
        new RegExp(`alter table public\\.${table} enable row level security`),
        `expected RLS to be enabled on ${table}`,
      );
      assert.match(
        migrationSql,
        new RegExp(`revoke all on public\\.${table} from anon, authenticated`),
        `expected anon/authenticated grants to be revoked on ${table}`,
      );
      // No client-facing policy should exist for these tables in Phase 1 — RLS-enabled with
      // zero policies is what makes them default-deny for anon/authenticated.
      assert.doesNotMatch(
        migrationSql,
        new RegExp(`create policy[^;]*on public\\.${table}`, "s"),
        `expected no client-facing RLS policy on ${table}`,
      );
    });
  }

  it("does not lock down customer_accounts — it is business data, not integration state", () => {
    assert.doesNotMatch(migrationSql, /alter table public\.customer_accounts enable row level security/);
  });
});
