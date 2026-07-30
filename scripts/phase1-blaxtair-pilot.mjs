/**
 * Phase 1 Blaxtair pilot: verify schema / seed / pairing via service role.
 * Usage:
 *   node --experimental-strip-types scripts/phase1-blaxtair-pilot.mjs verify-empty
 *   node --experimental-strip-types scripts/phase1-blaxtair-pilot.mjs seed
 *   node --experimental-strip-types scripts/phase1-blaxtair-pilot.mjs verify-seed
 *   node --experimental-strip-types scripts/phase1-blaxtair-pilot.mjs smoke-db
 *   node --experimental-strip-types scripts/phase1-blaxtair-pilot.mjs smoke-fallback
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BLAXTAIR_ID = "b3d9abe4-e457-4bb4-935b-4bb01920df89";
const EXPECTED_KEYS = [
  "blaxtair_ahd",
  "blaxtair_mr130_mr260",
  "blaxtair_origin",
  "blaxtair_3",
  "blaxtair_ssc_speed",
];

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

function serviceClient() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpcOrThrow(client, sql) {
  // Prefer postgres via REST rpc if available; otherwise use from() for table ops.
  // For arbitrary SQL we use the PostgREST-less approach: only table operations in this script,
  // plus a dedicated verify via information_schema through a temporary approach.
  void client;
  void sql;
  throw new Error("use dedicated helpers");
}

async function verifyEmpty() {
  const client = serviceClient();
  const { data, error, count } = await client
    .from("company_form_products")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`verifyEmpty: ${error.message}`);
  console.log(JSON.stringify({ ok: true, rowCount: count ?? 0, note: "table reachable" }, null, 2));
  if ((count ?? 0) !== 0) {
    throw new Error(`Expected empty company_form_products before seed, found ${count}`);
  }
}

async function verifySchemaObjects() {
  const client = serviceClient();
  // Probe table + RLS by selecting; check constraints via insert rejection patterns later.
  const { error } = await client.from("company_form_products").select("id").limit(1);
  if (error) throw new Error(`schema probe failed: ${error.message}`);

  // Confirm companies / unrelated tables still readable
  const companies = await client.from("companies").select("id").eq("id", BLAXTAIR_ID).maybeSingle();
  if (companies.error) throw new Error(`companies probe: ${companies.error.message}`);
  if (!companies.data) throw new Error("Blaxtair company row missing");

  console.log(
    JSON.stringify(
      {
        ok: true,
        table: "company_form_products",
        blaxtairCompanyPresent: true,
        blaxtairCompanyId: BLAXTAIR_ID,
      },
      null,
      2,
    ),
  );
}

async function seedBlaxtair() {
  const client = serviceClient();
  const rows = [
    {
      company_id: BLAXTAIR_ID,
      product_key: "blaxtair_ahd",
      display_label: "Blaxtair AHD",
      base_form_id: "ppd",
      section_key: "blaxtair_ahd",
      submission_type: "blaxtair_ahd",
      draft_key: "blaxtair_ahd",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 200,
      configuration: {
        allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
        maxAdditionalCount: 1,
      },
    },
    {
      company_id: BLAXTAIR_ID,
      product_key: "blaxtair_mr130_mr260",
      display_label: "Blaxtair MR130-MR260",
      base_form_id: "ppd",
      section_key: "blaxtair_mr130_mr260",
      submission_type: "blaxtair_mr130_mr260",
      draft_key: "blaxtair_mr130_mr260",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 210,
      configuration: {
        allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
        maxAdditionalCount: 1,
      },
    },
    {
      company_id: BLAXTAIR_ID,
      product_key: "blaxtair_origin",
      display_label: "Blaxtair Origin",
      base_form_id: "ppd",
      section_key: "blaxtair_origin",
      submission_type: "blaxtair_origin",
      draft_key: "blaxtair_origin",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 220,
      configuration: {
        allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
        maxAdditionalCount: 1,
      },
    },
    {
      company_id: BLAXTAIR_ID,
      product_key: "blaxtair_3",
      display_label: "Blaxtair 3",
      base_form_id: "ppd",
      section_key: "blaxtair_3",
      submission_type: "blaxtair_3",
      draft_key: "blaxtair_3",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 230,
      configuration: {
        allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
        maxAdditionalCount: 1,
      },
    },
    {
      company_id: BLAXTAIR_ID,
      product_key: "blaxtair_ssc_speed",
      display_label: "SSC Speed",
      base_form_id: "speed_ssc",
      section_key: "blaxtair_ssc_speed",
      submission_type: "blaxtair_ssc_speed",
      draft_key: "blaxtair_ssc_speed",
      allow_primary: false,
      allow_additional: true,
      active: true,
      display_order: 240,
      configuration: {},
    },
  ];

  const { data, error } = await client
    .from("company_form_products")
    .upsert(rows, { onConflict: "company_id,product_key" })
    .select(
      "product_key, display_label, base_form_id, allow_primary, allow_additional, active, display_order, configuration",
    );
  if (error) throw new Error(`seed failed: ${error.message}`);
  console.log(JSON.stringify({ ok: true, insertedOrUpdated: data?.length ?? 0, rows: data }, null, 2));
}

async function verifySeed() {
  const client = serviceClient();
  const { data, error } = await client
    .from("company_form_products")
    .select(
      "company_id, product_key, display_label, base_form_id, allow_primary, allow_additional, active, display_order, configuration",
    )
    .eq("company_id", BLAXTAIR_ID)
    .order("display_order", { ascending: true });
  if (error) throw new Error(`verifySeed: ${error.message}`);
  const keys = (data || []).map((r) => r.product_key);
  const devices = (data || []).filter((r) => r.product_key !== "blaxtair_ssc_speed");
  const ssc = (data || []).find((r) => r.product_key === "blaxtair_ssc_speed");

  const checks = {
    rowCount: data?.length ?? 0,
    exactFive: (data?.length ?? 0) === 5,
    keysMatch: EXPECTED_KEYS.every((k) => keys.includes(k)) && keys.length === 5,
    devicesUsePpd: devices.every((d) => d.base_form_id === "ppd"),
    devicesAllowPrimary: devices.every((d) => d.allow_primary === true && d.allow_additional === false),
    sscBase: ssc?.base_form_id === "speed_ssc",
    sscSecondaryOnly: ssc?.allow_primary === false && ssc?.allow_additional === true,
    noOtherCompanies: (data || []).every((r) => r.company_id === BLAXTAIR_ID),
  };

  // Global uniqueness / no extras for this company
  const { count, error: countErr } = await client
    .from("company_form_products")
    .select("id", { count: "exact", head: true });
  if (countErr) throw new Error(countErr.message);

  console.log(
    JSON.stringify(
      {
        ok: Object.values(checks).every(Boolean),
        checks,
        totalTableRows: count,
        rows: data,
      },
      null,
      2,
    ),
  );
  if (!Object.values(checks).every(Boolean)) throw new Error("Seed verification failed");
  if ((count ?? 0) !== 5) throw new Error(`Expected exactly 5 rows in table, found ${count}`);
}

async function smokeDb() {
  // Import TS modules via strip-types dynamic import path relative
  const { resolveCompanyProducts, getAllowedPrimaryProducts, getAllowedAdditionalProducts, areAdditionalProductsAllowed } =
    await import("../lib/product-config/resolve-company-products.ts");
  const { findSingleInstancePairingConfigWarnings } = await import("../lib/product-config/pairing-guardrails.ts");
  const { buildProductLookupMaps, getProductLabelWithLookup } = await import("../lib/product-config/product-lookup.ts");

  const client = serviceClient();
  const result = await resolveCompanyProducts({
    companyId: BLAXTAIR_ID,
    companyName: "Blaxtair",
    fetchProducts: async (id) => {
      const { data, error } = await client.from("company_form_products").select("*").eq("company_id", id);
      if (error) return { rows: [], error: error.message };
      return { rows: data || [] };
    },
  });

  const primary = getAllowedPrimaryProducts(result.products).map((p) => p.productKey);
  const additional = getAllowedAdditionalProducts(result.products, "blaxtair_ahd").map((p) => p.productKey);
  const maps = buildProductLookupMaps(result.products);
  const warnings = findSingleInstancePairingConfigWarnings(result.products);

  const report = {
    usedDatabase: result.usedDatabase,
    source: result.source,
    primary,
    additionalForAhd: additional,
    allowAhdPlusSsc: areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_ssc_speed"]),
    rejectTwoDevices: areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_3"]) === false,
    sscNotPrimary: !primary.includes("blaxtair_ssc_speed"),
    labelAhd: getProductLabelWithLookup("blaxtair_ahd", maps),
    pairingWarningsCount: warnings.length,
    pairingWarnings: warnings,
  };
  console.log(JSON.stringify({ ok: true, report }, null, 2));
  if (!report.usedDatabase) throw new Error("Expected DB-backed products");
  if (!report.allowAhdPlusSsc || !report.rejectTwoDevices || !report.sscNotPrimary) {
    throw new Error("Pairing smoke failed");
  }
}

async function smokeFallback() {
  const { resolveCompanyProducts, getAllowedPrimaryProducts } = await import(
    "../lib/product-config/resolve-company-products.ts"
  );
  const result = await resolveCompanyProducts({
    companyId: BLAXTAIR_ID,
    companyName: "Blaxtair",
    fetchProducts: async () => ({ rows: [], error: "forced pilot fallback simulation" }),
  });
  const primary = getAllowedPrimaryProducts(result.products).map((p) => p.productKey);
  console.log(
    JSON.stringify(
      {
        ok: true,
        fellBackDueToError: result.fellBackDueToError,
        source: result.source,
        usedDatabase: result.usedDatabase,
        primary,
        note: "DB rows were not deleted; failure simulated in fetchProducts only",
      },
      null,
      2,
    ),
  );
  if (!result.fellBackDueToError || result.source !== "registry") throw new Error("Fallback smoke failed");
}

const cmd = process.argv[2] || "help";
const runners = {
  "verify-empty": verifyEmpty,
  "verify-schema": verifySchemaObjects,
  seed: seedBlaxtair,
  "verify-seed": verifySeed,
  "smoke-db": smokeDb,
  "smoke-fallback": smokeFallback,
};

if (!runners[cmd]) {
  console.error(`Unknown command ${cmd}. Use: ${Object.keys(runners).join(", ")}`);
  process.exit(1);
}
await runners[cmd]();
