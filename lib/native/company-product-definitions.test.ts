import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUpsertStatement, parseStoredRows, saveViaConnection, type RunQueryConnection } from "./company-product-definitions.ts";
import type { CompanyFormProductRow } from "../product-config/types.ts";

function productRow(overrides: Partial<CompanyFormProductRow> = {}): CompanyFormProductRow {
  return {
    id: "row-1",
    company_id: "company-1",
    product_key: "widget",
    display_label: "Widget",
    base_form_id: "base-form-1",
    section_key: "install",
    submission_type: "primary",
    draft_key: "widget-draft",
    allow_primary: true,
    allow_additional: false,
    active: true,
    display_order: 1,
    configuration: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as CompanyFormProductRow;
}

describe("buildUpsertStatement (pure) — definition DTO serialization", () => {
  it("is a single INSERT ... ON CONFLICT statement JSON-serializing the raw rows verbatim", () => {
    const rows = [productRow(), productRow({ id: "row-2", product_key: "gadget" })];
    const { statement, values } = buildUpsertStatement("company-1", rows, "2026-01-01T00:00:00.000Z");
    assert.match(statement, /^INSERT INTO company_product_definitions/);
    assert.match(statement, /ON CONFLICT\(company_id\) DO UPDATE SET/);
    assert.deepEqual(values, ["company-1", JSON.stringify(rows), 1, "2026-01-01T00:00:00.000Z"]);
  });

  it("always writes a row even for a legitimately zero-product company — the 'checked, genuinely empty' signal", () => {
    const { values } = buildUpsertStatement("company-1", [], "2026-01-01T00:00:00.000Z");
    assert.equal(values[1], "[]");
  });

  it("round-trips a row's full shape through JSON with no field loss", () => {
    const rows = [productRow({ configuration: { pairing: { fieldKey: "unit" } } as unknown as CompanyFormProductRow["configuration"] })];
    const { values } = buildUpsertStatement("company-1", rows, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(JSON.parse(values[1] as string), rows);
  });
});

describe("parseStoredRows (pure) — the read-side counterpart of the same DTO", () => {
  it("decodes a well-formed JSON array back into the same rows", () => {
    const rows = [productRow(), productRow({ id: "row-2" })];
    assert.deepEqual(parseStoredRows(JSON.stringify(rows)), rows);
  });

  it("decodes an empty array as an empty array, not null/undefined", () => {
    assert.deepEqual(parseStoredRows("[]"), []);
  });

  it("fails closed to an empty array on malformed JSON rather than throwing", () => {
    assert.deepEqual(parseStoredRows("{not valid json"), []);
  });

  it("fails closed to an empty array when the JSON is valid but not an array", () => {
    assert.deepEqual(parseStoredRows(JSON.stringify({ not: "an array" })), []);
  });
});

const TRIGGER_FAILURE = "TRIGGER_FAILURE";

class FakeSqliteConnection implements RunQueryConnection {
  rows = new Map<string, { rows: string; schemaVersion: number; syncedAt: string }>();

  async run(statement: string, values: unknown[] = []): Promise<unknown> {
    if (values.some((v) => typeof v === "string" && v.includes(TRIGGER_FAILURE))) {
      throw new Error("simulated write failure");
    }
    if (statement.startsWith("INSERT INTO company_product_definitions")) {
      const [companyId, rowsJson, schemaVersion, syncedAt] = values as [string, string, number, string];
      this.rows.set(companyId, { rows: rowsJson, schemaVersion, syncedAt });
    }
    return undefined;
  }

  async query(): Promise<{ values?: Array<Record<string, unknown>> }> {
    return { values: [] };
  }
}

describe("saveViaConnection (upsert-by-key behavior — successful replacement / failed refresh preserves old)", () => {
  it("stores a new package under its companyId key", async () => {
    const db = new FakeSqliteConnection();
    const rows = [productRow()];
    const result = await saveViaConnection(db, "company-1", rows);
    assert.deepEqual(JSON.parse(db.rows.get("company-1")?.rows ?? "null"), rows);
    assert.equal(db.rows.get("company-1")?.syncedAt, result.syncedAt);
  });

  it("a second successful save for the SAME company replaces the rows, not duplicates them", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, "company-1", [productRow({ id: "old-row" })]);
    await saveViaConnection(db, "company-1", [productRow({ id: "new-row" })]);
    assert.equal(db.rows.size, 1);
    assert.deepEqual(JSON.parse(db.rows.get("company-1")?.rows ?? "null"), [productRow({ id: "new-row" })]);
  });

  it("a failed write (failed refresh) leaves the previously synced definitions completely untouched", async () => {
    const db = new FakeSqliteConnection();
    const goodRows = [productRow({ id: "good-row" })];
    const first = await saveViaConnection(db, "company-1", goodRows);
    const before = structuredClone(db.rows.get("company-1"));

    await assert.rejects(
      () => saveViaConnection(db, "company-1", [productRow({ id: TRIGGER_FAILURE })]),
      /simulated write failure/,
    );

    assert.deepEqual(db.rows.get("company-1"), before, "previous definitions must survive a failed refresh untouched");
    assert.equal(before?.syncedAt, first.syncedAt);
  });

  it("different companies never collide — company scoping", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, "company-1", [productRow({ id: "row-a" })]);
    await saveViaConnection(db, "company-2", [productRow({ id: "row-b" })]);
    assert.deepEqual(JSON.parse(db.rows.get("company-1")?.rows ?? "null"), [productRow({ id: "row-a" })]);
    assert.deepEqual(JSON.parse(db.rows.get("company-2")?.rows ?? "null"), [productRow({ id: "row-b" })]);
  });
});
