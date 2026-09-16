import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEnsureSettingsTableSql, buildSelectSettingSql, buildUpsertSettingSql } from "./database.ts";

describe("lib/native/database.ts SQL builders", () => {
  it("buildEnsureSettingsTableSql creates the app_settings table if missing", () => {
    const sql = buildEnsureSettingsTableSql();
    assert.match(sql, /CREATE TABLE IF NOT EXISTS app_settings/);
    assert.match(sql, /key TEXT PRIMARY KEY NOT NULL/);
    assert.match(sql, /value TEXT NOT NULL/);
  });

  it("buildUpsertSettingSql upserts by key", () => {
    const sql = buildUpsertSettingSql();
    assert.match(sql, /INSERT INTO app_settings \(key, value\) VALUES \(\?, \?\)/);
    assert.match(sql, /ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value/);
  });

  it("buildSelectSettingSql selects a single row by key", () => {
    const sql = buildSelectSettingSql();
    assert.match(sql, /SELECT value FROM app_settings WHERE key = \? LIMIT 1/);
  });
});
