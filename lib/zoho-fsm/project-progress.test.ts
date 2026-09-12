import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProjectProgressByProjectId } from "./project-progress.ts";

describe("buildProjectProgressByProjectId", () => {
  it("keys the SA Target/Finalized Asset Count by project_id", () => {
    const byProjectId = buildProjectProgressByProjectId([
      { project_id: "p1", sa_target_asset_count: 6, sa_finalized_asset_count: null },
      { project_id: "p2", sa_target_asset_count: 100, sa_finalized_asset_count: 17 },
    ]);
    assert.deepEqual(byProjectId, {
      p1: { saTargetAssetCount: 6, saFinalizedAssetCount: null },
      p2: { saTargetAssetCount: 100, saFinalizedAssetCount: 17 },
    });
  });

  it("preserves Finalized = 0 rather than dropping/nulling it", () => {
    const byProjectId = buildProjectProgressByProjectId([
      { project_id: "p1", sa_target_asset_count: 6, sa_finalized_asset_count: 0 },
    ]);
    assert.equal(byProjectId.p1.saFinalizedAssetCount, 0);
    assert.notEqual(byProjectId.p1.saFinalizedAssetCount, null);
  });

  it("returns an empty map for no rows (a non-Zoho-linked project has none)", () => {
    assert.deepEqual(buildProjectProgressByProjectId([]), {});
  });

  it("skips a row with a blank project_id defensively", () => {
    const byProjectId = buildProjectProgressByProjectId([
      { project_id: "", sa_target_asset_count: 6, sa_finalized_asset_count: null },
    ]);
    assert.deepEqual(byProjectId, {});
  });
});
