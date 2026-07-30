import {
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";
import { fetchAllCompanyFormProductCounts } from "@/lib/product-config/repository";

export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  const accessToken = extractBearerToken(req);
  const auth = await authorizeGlobalAdmin({ env, accessToken });
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const { data: companies, error: companiesError } = await auth.serviceClient
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });

  if (companiesError) {
    return Response.json({ error: companiesError.message }, { status: 500 });
  }

  const { counts, error: countsError } = await fetchAllCompanyFormProductCounts(auth.serviceClient);
  let tableAvailable = true;
  if (countsError) {
    console.warn("[admin/form-products] count query failed", countsError);
    if (/does not exist|Could not find the table/i.test(countsError)) {
      tableAvailable = false;
    }
  }

  const list = (companies || []).map((c) => {
    const id = String((c as { id: string }).id);
    const name = String((c as { name: string }).name || "");
    const dbCount = counts[id] || 0;
    return {
      id,
      name,
      productCount: dbCount,
      configMode: (!tableAvailable || dbCount === 0 ? "registry" : "database") as "registry" | "database",
    };
  });

  return Response.json({ companies: list, tableAvailable });
}
