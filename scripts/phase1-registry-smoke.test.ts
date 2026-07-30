/**
 * Pre-apply registry fallback smoke (no DB products).
 * Run: node --experimental-strip-types --test scripts/phase1-registry-smoke.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLAXTAIR_COMPANY_ID,
  BLAXTAIR_COMPANY_NAME,
} from "../lib/form-registry.ts";
import {
  areAdditionalProductsAllowed,
  getAllowedAdditionalProducts,
  getAllowedPrimaryProducts,
  resolveCompanyProducts,
} from "../lib/product-config/resolve-company-products.ts";

async function resolveRegistryOnly(companyName: string, companyId?: string) {
  return resolveCompanyProducts({
    companyId: companyId || "00000000-0000-0000-0000-000000000001",
    companyName,
    fetchProducts: async () => ({ rows: [] }),
  });
}

describe("Phase 1 pre-apply registry fallback smoke", () => {
  it("Matrix loads from registry", async () => {
    const result = await resolveRegistryOnly("Matrix");
    assert.equal(result.source, "registry");
    assert.equal(result.usedDatabase, false);
    assert.deepEqual(
      getAllowedPrimaryProducts(result.products).map((p) => p.productKey),
      ["PPD", "Speed Transmon", "Speed SSC"],
    );
  });

  it("Powerfleet loads from registry", async () => {
    const result = await resolveRegistryOnly("Powerfleet");
    assert.equal(result.source, "registry");
    assert.ok(result.selectableProducts.length >= 5);
    assert.ok(result.selectableProducts.some((p) => p.productKey === "VAC4"));
    assert.ok(result.selectableProducts.some((p) => p.productKey === "PPD"));
  });

  it("LinxUp loads from registry", async () => {
    const result = await resolveRegistryOnly("LinxUp");
    assert.equal(result.source, "registry");
    assert.ok(result.selectableProducts.every((p) => p.profileId === "linxup_install"));
    assert.ok(result.selectableProducts.length >= 3);
  });

  it("Blaxtair loads from registry (pre-seed)", async () => {
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({ rows: [] }),
    });
    assert.equal(result.source, "registry");
    assert.deepEqual(
      getAllowedPrimaryProducts(result.products).map((p) => p.productKey),
      ["blaxtair_ahd", "blaxtair_mr130_mr260", "blaxtair_origin", "blaxtair_3"],
    );
    assert.deepEqual(
      getAllowedAdditionalProducts(result.products, "blaxtair_ahd").map((p) => p.productKey),
      ["blaxtair_ssc_speed"],
    );
    assert.equal(areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_ssc_speed"]), true);
    assert.equal(areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_3"]), false);
  });

  it("DB fetch failure still falls back without throwing", async () => {
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({ rows: [], error: "simulated table missing" }),
    });
    assert.equal(result.fellBackDueToError, true);
    assert.equal(result.source, "registry");
    assert.ok(result.selectableProducts.length > 0);
  });
});
