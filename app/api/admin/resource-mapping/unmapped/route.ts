import { NextResponse } from "next/server";
import { authorizeGlobalAdmin, extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { deriveUnmappedResources, fetchMappedResourceIds, fetchObservedResourceCatalog } from "@/lib/zoho-fsm/resource-map";

export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  const auth = await authorizeGlobalAdmin({ env, accessToken: extractBearerToken(req) });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const [catalog, mappedIds] = await Promise.all([
      fetchObservedResourceCatalog(auth.serviceClient),
      fetchMappedResourceIds(auth.serviceClient),
    ]);
    const unmapped = deriveUnmappedResources(catalog, mappedIds);
    return NextResponse.json({ resources: unmapped });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load unmapped Zoho resources.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
