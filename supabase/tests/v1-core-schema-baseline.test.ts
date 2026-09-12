import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

// Static regression check for the V1 core schema baseline migration. This repo has no live
// Supabase instance to actually replay migrations against here, so this asserts on migration
// SQL text: it locks in the fix for the empty-preview-branch bug (an unguarded UPDATE against
// job_card_drafts in 20260426_phase1_company_project.sql fails on a fresh database because no
// migration ever created that table) and guards against ever re-introducing it.
//
// Lives outside supabase/migrations/ deliberately: the Supabase CLI scans every file in that
// directory and expects each one to match "<timestamp>_name.sql" (confirmed via
// `supabase migration list --db-url ...`, which otherwise logs "Skipping migration
// v1-core-schema-baseline.test.ts...").
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const BASELINE_FILE = "20260425000000_v1_core_schema_baseline.sql";
const baselineSql = readFileSync(path.join(migrationsDir, BASELINE_FILE), "utf8");

// Strip SQL line-comments so assertions about "active" SQL aren't fooled by explanatory prose
// or intentionally-commented-out (pending) statements.
function activeSql(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}
const activeBaselineSql = activeSql(baselineSql);

function allMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

describe("V1 core schema baseline migration", () => {
  it("sorts before 20260426_phase1_company_project.sql (must run first on a fresh database)", () => {
    const files = allMigrationFiles();
    const baselineIndex = files.indexOf(BASELINE_FILE);
    const dependentIndex = files.indexOf("20260426_phase1_company_project.sql");
    assert.ok(baselineIndex >= 0, "baseline file must exist");
    assert.ok(dependentIndex >= 0, "20260426_phase1_company_project.sql must exist");
    assert.ok(
      baselineIndex < dependentIndex,
      "baseline must sort before the migration whose unguarded UPDATE depends on it",
    );
  });

  it("creates job_card_drafts and job_card_submissions with IF NOT EXISTS (safe to replay against production)", () => {
    assert.match(activeBaselineSql, /create table if not exists public\.job_card_drafts/i);
    assert.match(activeBaselineSql, /create table if not exists public\.job_card_submissions/i);
  });

  it("matches production's confirmed identity shape: surrogate id primary key + separate submission_id unique constraint", () => {
    // Production: PRIMARY KEY (id), UNIQUE (submission_id) — NOT submission_id as the PK.
    assert.match(activeBaselineSql, /id uuid primary key default gen_random_uuid\(\)/);
    assert.match(activeBaselineSql, /submission_id text not null unique/);
    assert.doesNotMatch(activeBaselineSql, /submission_id text primary key/);
  });

  it("matches production's confirmed created_at/updated_at nullability", () => {
    // job_card_drafts: both created_at and updated_at are nullable with a default (confirmed).
    const draftsBlock = activeBaselineSql.match(/create table if not exists public\.job_card_drafts\s*\(([\s\S]*?)\);/);
    assert.ok(draftsBlock, "job_card_drafts table body must be present");
    assert.match(draftsBlock![1], /created_at timestamptz default now\(\)/);
    assert.match(draftsBlock![1], /updated_at timestamptz default now\(\)/);
    assert.doesNotMatch(draftsBlock![1], /created_at timestamptz not null/);
    assert.doesNotMatch(draftsBlock![1], /updated_at timestamptz not null/);

    // job_card_submissions: created_at is NOT NULL (confirmed); no updated_at column at all.
    const submissionsBlock = activeBaselineSql.match(
      /create table if not exists public\.job_card_submissions\s*\(([\s\S]*?)\);/,
    );
    assert.ok(submissionsBlock, "job_card_submissions table body must be present");
    assert.match(submissionsBlock![1], /created_at timestamptz not null default now\(\)/);
    assert.doesNotMatch(submissionsBlock![1], /\bupdated_at\b/);
  });

  it("does not duplicate columns that later migrations add via ALTER TABLE", () => {
    // Check for actual column definitions (e.g. "company_id uuid"), not the explanatory
    // prose comments in this file that legitimately mention these names.
    // company_id/project_id (and their FKs/composite indexes) belong to
    // 20260426_phase1_company_project.sql.
    assert.doesNotMatch(activeBaselineSql, /\bcompany_id\s+uuid\b/);
    assert.doesNotMatch(activeBaselineSql, /\bproject_id\s+uuid\b/);
    // Email-history columns belong to 202607120001_job_card_email_history.sql.
    assert.doesNotMatch(activeBaselineSql, /\blast_email_\w+\s+(timestamptz|text|jsonb|uuid)\b/);
  });

  it("registers the job-card-photos bucket as public, matching how the app builds public photo URLs", () => {
    assert.match(activeBaselineSql, /insert into storage\.buckets/i);
    assert.match(baselineSql, /'job-card-photos'/);
    assert.match(activeBaselineSql, /'job-card-photos',\s*true/);
  });

  it("reproduces production's exact job-card-photos policy names and behavior: public SELECT + public INSERT, no UPDATE/DELETE", () => {
    // Exact production policy names, not a cosmetic rename.
    assert.match(activeBaselineSql, /create policy "Allow reads \(dev\) 17gh87i_0"/);
    assert.match(activeBaselineSql, /create policy "Allow uploads \(dev\) 17gh87i_0"/);
    assert.match(activeBaselineSql, /drop policy if exists "Allow reads \(dev\) 17gh87i_0"/);
    assert.match(activeBaselineSql, /drop policy if exists "Allow uploads \(dev\) 17gh87i_0"/);

    const selectPolicy = activeBaselineSql.match(/create policy "Allow reads \(dev\) 17gh87i_0"[^;]*;/is);
    assert.ok(selectPolicy, "expected the SELECT policy");
    assert.match(selectPolicy![0], /for select/i);
    assert.match(selectPolicy![0], /to public/i);
    assert.match(selectPolicy![0], /using \(bucket_id = 'job-card-photos'\)/);
    assert.doesNotMatch(selectPolicy![0], /with check/i, "production's read policy has no WITH CHECK");

    const insertPolicy = activeBaselineSql.match(/create policy "Allow uploads \(dev\) 17gh87i_0"[^;]*;/is);
    assert.ok(insertPolicy, "expected the INSERT policy");
    assert.match(insertPolicy![0], /for insert/i);
    assert.match(insertPolicy![0], /to public/i);
    assert.match(insertPolicy![0], /with check \(bucket_id = 'job-card-photos'\)/);
    assert.doesNotMatch(insertPolicy![0], /\busing\s*\(/i, "production's upload policy has no USING clause");

    // Production has no UPDATE/DELETE policy for this bucket — the baseline must not invent one.
    assert.doesNotMatch(activeBaselineSql, /for update/i);
    assert.doesNotMatch(activeBaselineSql, /for delete/i);

    // Exactly two active policies total.
    const policyCount = (activeBaselineSql.match(/create policy/gi) || []).length;
    assert.equal(policyCount, 2);
  });

  it("is the only migration that creates job_card_drafts/job_card_submissions or the job-card-photos bucket", () => {
    for (const file of allMigrationFiles()) {
      if (file === BASELINE_FILE) continue;
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      assert.doesNotMatch(
        sql,
        /create table (if not exists )?public\.job_card_drafts\s*\(/i,
        `${file} must not also create job_card_drafts`,
      );
      assert.doesNotMatch(
        sql,
        /create table (if not exists )?public\.job_card_submissions\s*\(/i,
        `${file} must not also create job_card_submissions`,
      );
      assert.doesNotMatch(
        sql,
        /'job-card-photos'/,
        `${file} must not also reference the job-card-photos bucket`,
      );
    }
  });
});
