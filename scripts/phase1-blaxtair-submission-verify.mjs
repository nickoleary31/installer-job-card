/**
 * Live DB productDisplay / email-label verification (no submission write).
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveCompanyProducts,
  getAllowedPrimaryProducts,
  getAllowedAdditionalProducts,
  areAdditionalProductsAllowed,
} from "../lib/product-config/resolve-company-products.ts";
import {
  buildProductLookupMaps,
  getProductLabelWithLookup,
  resolveEffectiveSectionKeyWithLookup,
  toProductDisplayContext,
} from "../lib/product-config/product-lookup.ts";
import { getFormLabelBySectionKey } from "../lib/form-registry.ts";

const BLAXTAIR_ID = "b3d9abe4-e457-4bb4-935b-4bb01920df89";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^"|"$/g, "").trim();
  }
  return env;
}

const env = loadEnvLocal();
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await resolveCompanyProducts({
  companyId: BLAXTAIR_ID,
  companyName: "Blaxtair",
  fetchProducts: async (id) => {
    const { data, error } = await client.from("company_form_products").select("*").eq("company_id", id);
    if (error) return { rows: [], error: error.message };
    return { rows: data || [] };
  },
});

assert.equal(result.usedDatabase, true);
const maps = buildProductLookupMaps(result.products);
const display = toProductDisplayContext(maps);

assert.equal(getProductLabelWithLookup("blaxtair_ahd", display), "Blaxtair AHD");
assert.equal(getProductLabelWithLookup("blaxtair_ssc_speed", display), "SSC Speed");
assert.equal(resolveEffectiveSectionKeyWithLookup("blaxtair_ahd", display), "PPD");
assert.equal(resolveEffectiveSectionKeyWithLookup("blaxtair_ssc_speed", display), "Speed SSC");

// Stable IDs remain the product keys (not friendly labels)
assert.deepEqual(
  getAllowedPrimaryProducts(result.products).map((p) => p.productKey),
  ["blaxtair_ahd", "blaxtair_mr130_mr260", "blaxtair_origin", "blaxtair_3"],
);
assert.deepEqual(getAllowedAdditionalProducts(result.products, "blaxtair_origin").map((p) => p.productKey), [
  "blaxtair_ssc_speed",
]);
assert.equal(areAdditionalProductsAllowed(result.products, "blaxtair_3", ["blaxtair_ssc_speed"]), true);
assert.equal(areAdditionalProductsAllowed(result.products, "blaxtair_3", ["blaxtair_ahd"]), false);

// Registry still has Blaxtair defs for fallback labels; DB display overrides via maps only
assert.equal(getFormLabelBySectionKey("blaxtair_ahd"), "Blaxtair AHD");

const simulatedPayload = {
  hardwareSelection: { primary: "blaxtair_ahd", hasAdditional: "Yes", additional: ["blaxtair_ssc_speed"] },
  productDisplay: display,
  selectedSections: ["blaxtair_ahd", "blaxtair_ssc_speed"],
};

console.log(
  JSON.stringify(
    {
      ok: true,
      note: "No production submission row created; verified productDisplay + pairing against live DB rows",
      usedDatabase: result.usedDatabase,
      simulatedStableIds: {
        primary: simulatedPayload.hardwareSelection.primary,
        additional: simulatedPayload.hardwareSelection.additional,
      },
      simulatedFriendlyLabels: {
        primary: getProductLabelWithLookup(simulatedPayload.hardwareSelection.primary, display),
        additional: simulatedPayload.hardwareSelection.additional.map((k) =>
          getProductLabelWithLookup(k, display),
        ),
      },
      effectiveBases: {
        primary: resolveEffectiveSectionKeyWithLookup(simulatedPayload.hardwareSelection.primary, display),
        additional: simulatedPayload.hardwareSelection.additional.map((k) =>
          resolveEffectiveSectionKeyWithLookup(k, display),
        ),
      },
    },
    null,
    2,
  ),
);
