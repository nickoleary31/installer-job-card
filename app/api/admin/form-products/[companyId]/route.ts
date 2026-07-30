import {
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";
import { isKnownBaseFormId, listSelectableBaseForms } from "@/lib/product-config/base-forms";
import {
  mergeProductConfiguration,
  parseProductConfiguration,
} from "@/lib/product-config/configuration";
import { findSingleInstancePairingConfigWarnings } from "@/lib/product-config/pairing-guardrails";
import { normalizeDatabaseProductRow } from "@/lib/product-config/resolve-company-products";
import {
  fetchCompanyFormProducts,
  insertCompanyFormProduct,
  setCompanyFormProductActive,
  updateCompanyFormProduct,
} from "@/lib/product-config/repository";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function pairingWarningsForRows(
  rows: Parameters<typeof normalizeDatabaseProductRow>[0][],
): string[] {
  return findSingleInstancePairingConfigWarnings(rows.map(normalizeDatabaseProductRow));
}

export async function GET(
  req: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId: rawCompanyId } = await context.params;
  const companyId = (rawCompanyId || "").trim();
  const env = getSupabaseServerEnv();
  const accessToken = extractBearerToken(req);
  const auth = await authorizeGlobalAdmin({ env, accessToken });
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (!companyId) {
    return Response.json({ error: "Company id is required." }, { status: 400 });
  }

  const { data: company, error: companyError } = await auth.serviceClient
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    return Response.json({ error: companyError.message }, { status: 500 });
  }
  if (!company) {
    return Response.json({ error: "Company not found." }, { status: 404 });
  }

  const { rows, error } = await fetchCompanyFormProducts(auth.serviceClient, companyId);
  if (error) {
    const tableMissing = /does not exist|Could not find the table/i.test(error);
    return Response.json(
      {
        error: tableMissing
          ? "company_form_products table is not available. Apply migration 20260730120000 first."
          : error,
        company,
        products: [],
        baseForms: listSelectableBaseForms().map((f) => ({ id: f.id, label: f.label })),
        tableAvailable: !tableMissing,
      },
      { status: tableMissing ? 503 : 500 },
    );
  }

  return Response.json({
    company,
    products: rows,
    baseForms: listSelectableBaseForms().map((f) => ({ id: f.id, label: f.label })),
    pairingWarnings: pairingWarningsForRows(rows),
    tableAvailable: true,
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId: rawCompanyId } = await context.params;
  const companyId = (rawCompanyId || "").trim();
  const env = getSupabaseServerEnv();
  const accessToken = extractBearerToken(req);
  const auth = await authorizeGlobalAdmin({ env, accessToken });
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (!companyId) {
    return Response.json({ error: "Company id is required." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = asString(body.action) || "create";

  if (action === "create") {
    const productKey = asString(body.productKey).trim().toLowerCase();
    const displayLabel = asString(body.displayLabel).trim();
    const baseFormId = asString(body.baseFormId).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(productKey)) {
      return Response.json(
        { error: "Product key must be lowercase letters, numbers, and underscores." },
        { status: 400 },
      );
    }
    if (!displayLabel) {
      return Response.json({ error: "Display label is required." }, { status: 400 });
    }
    if (!isKnownBaseFormId(baseFormId)) {
      return Response.json({ error: `Unknown base form "${baseFormId}".` }, { status: 400 });
    }

    const result = await insertCompanyFormProduct(auth.serviceClient, {
      companyId,
      productKey,
      displayLabel,
      baseFormId,
      sectionKey: productKey,
      submissionType: productKey,
      draftKey: productKey,
      allowPrimary: asBool(body.allowPrimary, true),
      allowAdditional: asBool(body.allowAdditional, true),
      active: asBool(body.active, true),
      displayOrder: asInt(body.displayOrder, 100),
      configuration: parseProductConfiguration(body.configuration),
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    const { rows } = await fetchCompanyFormProducts(auth.serviceClient, companyId);
    return Response.json({
      product: result.row,
      pairingWarnings: pairingWarningsForRows(rows),
    });
  }

  if (action === "update") {
    const id = asString(body.id).trim();
    if (!id) return Response.json({ error: "Product id is required." }, { status: 400 });
    const displayLabel = asString(body.displayLabel).trim();
    const baseFormId = asString(body.baseFormId).trim();
    if (!displayLabel) {
      return Response.json({ error: "Display label is required." }, { status: 400 });
    }
    if (!isKnownBaseFormId(baseFormId)) {
      return Response.json({ error: `Unknown base form "${baseFormId}".` }, { status: 400 });
    }

    const { rows: existingRows } = await fetchCompanyFormProducts(auth.serviceClient, companyId);
    const existing = existingRows.find((r) => r.id === id);
    const configuration = mergeProductConfiguration({
      existing: existing?.configuration,
      incoming: body.configuration,
    });

    const result = await updateCompanyFormProduct(auth.serviceClient, {
      id,
      displayLabel,
      baseFormId,
      allowPrimary: asBool(body.allowPrimary, true),
      allowAdditional: asBool(body.allowAdditional, true),
      active: asBool(body.active, true),
      displayOrder: asInt(body.displayOrder, 100),
      configuration,
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    const { rows } = await fetchCompanyFormProducts(auth.serviceClient, companyId);
    return Response.json({
      product: result.row,
      pairingWarnings: pairingWarningsForRows(rows),
    });
  }

  if (action === "setActive") {
    const id = asString(body.id).trim();
    if (!id) return Response.json({ error: "Product id is required." }, { status: 400 });
    const result = await setCompanyFormProductActive(auth.serviceClient, id, asBool(body.active, false));
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ product: result.row });
  }

  return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
